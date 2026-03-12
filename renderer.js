const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const extractZip = require('extract-zip');
const childProcess = require('child_process');

const DEFAULT_REPO = "smartcmd/MinecraftConsoles";
const DEFAULT_EXEC = "Minecraft.Client.exe";
const TARGET_FILE = "LCEWindows64.zip";
const LAUNCHER_REPO = "gradenGnostic/LegacyLauncher";
const REPO_PRESETS = {
    default: 'smartcmd/MinecraftConsoles',
    noWatermark: 'cath0degaytube/MinecraftConsoles'
};

let instances = [];
let currentInstanceId = null;
let currentInstance = null;

let releasesData = [];
let commitsData = [];
let currentReleaseIndex = 0;
let isProcessing = false;
let isGameRunning = false;

let snapshotInstanceId = null;

const Store = {
    async get(key, defaultValue) {
        const val = await ipcRenderer.invoke('store-get', key);
        return val !== undefined ? val : defaultValue;
    },
    async set(key, value) {
        return await ipcRenderer.invoke('store-set', key, value);
    },
    async selectDirectory() {
        return await ipcRenderer.invoke('select-directory');
    }
};

const GamepadManager = {
    active: false,
    lastInputTime: 0,
    COOLDOWN: 180,
    loopStarted: false,
    lastAPressed: false,
    lastGuidePressed: false,
    controlLayoutMode: 'auto',

    setControlLayoutMode(mode = 'auto') {
        const validModes = ['auto', 'xbox', 'nintendo'];
        this.controlLayoutMode = validModes.includes(mode) ? mode : 'auto';
    },

    shouldSwapABButtons(gamepadId = '') {
        if (this.controlLayoutMode === 'nintendo') return true;
        if (this.controlLayoutMode === 'xbox') return false;

        const id = gamepadId.toLowerCase();
        return id.includes('nintendo switch pro controller') || id.includes(' switch pro controller') || id.includes('nintendo co., ltd');
    },

    init() {
        window.addEventListener("gamepadconnected", () => {
            if (!this.active) {
                this.startLoop();
            }
        });
        this.startLoop();
    },

    startLoop() {
        if (this.loopStarted) return;
        this.loopStarted = true;
        const loop = () => {
            try {
                this.poll();
            } catch (e) {
                console.error("Gamepad poll error:", e);
            }
            requestAnimationFrame(loop);
        };
        loop();
    },

    poll() {
        const gamepads = navigator.getGamepads();
        let gp = null;
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i] && gamepads[i].connected && gamepads[i].buttons.length > 0) {
                gp = gamepads[i];
                break;
            }
        }

        if (!gp) {
            this.lastGuidePressed = false;
            if (this.active) {
                this.active = false;
                showToast("Controller Disconnected");
            }
            return;
        }

        if (!this.active) {
            this.active = true;
            showToast("Controller Connected");
            if (!document.activeElement || !document.activeElement.classList.contains('nav-item')) {
                this.focusFirstVisible();
            }
        }

        const now = Date.now();
        const buttons = gp.buttons;
        const axes = gp.axes;

        const isPressed = (idx) => buttons[idx] ? buttons[idx].pressed : false;
        const getAxis = (idx) => axes[idx] !== undefined ? axes[idx] : 0;

        const shouldSwapAB = this.shouldSwapABButtons(gp.id);
        const confirmButton = shouldSwapAB ? 1 : 0;
        const cancelButton = shouldSwapAB ? 0 : 1;

        const guidePressed = isPressed(16) || isPressed(17);
        if (guidePressed && !this.lastGuidePressed) {
            showToast("Closing Launcher...");
            ipcRenderer.send('window-close');
            return;
        }
        this.lastGuidePressed = guidePressed;

        if (now - this.lastInputTime > this.COOLDOWN) {
            const threshold = 0.5;
            const axisX = getAxis(0);
            const axisY = getAxis(1);
            
            const up = isPressed(12) || axisY < -threshold;
            const down = isPressed(13) || axisY > threshold;
            const left = isPressed(14) || axisX < -threshold;
            const right = isPressed(15) || axisX > threshold;

            if (up) { UiSoundManager.setInputSource('controller'); this.navigate('up'); this.lastInputTime = now; }
            else if (down) { UiSoundManager.setInputSource('controller'); this.navigate('down'); this.lastInputTime = now; }
            else if (left) { UiSoundManager.setInputSource('controller'); this.navigate('left'); this.lastInputTime = now; }
            else if (right) { UiSoundManager.setInputSource('controller'); this.navigate('right'); this.lastInputTime = now; }
            
            else if (isPressed(4)) { UiSoundManager.setInputSource('controller'); this.cycleActiveSelection(-1); this.lastInputTime = now; }
            else if (isPressed(5)) { UiSoundManager.setInputSource('controller'); this.cycleActiveSelection(1); this.lastInputTime = now; }
            
            else if (isPressed(cancelButton)) { UiSoundManager.setInputSource('controller'); this.cancelCurrent(); this.lastInputTime = now; }

            else if (isPressed(2)) { UiSoundManager.setInputSource('controller'); checkForUpdatesManual(); this.lastInputTime = now; }
        }

        const aPressed = isPressed(confirmButton);
        if (aPressed && !this.lastAPressed) {
            UiSoundManager.setInputSource('controller');
            this.clickActive();
        }
        this.lastAPressed = aPressed;

        const rStickY = getAxis(3) || getAxis(2) || getAxis(5);
        if (Math.abs(rStickY) > 0.1) {
            this.scrollActive(rStickY * 15);
        }
    },

    focusFirstVisible() {
        const visibleItems = this.getVisibleNavItems();
        if (visibleItems.length > 0) visibleItems[0].focus();
    },

    getVisibleNavItems() {
        const modals = ['update-modal', 'options-modal', 'profile-modal', 'servers-modal', 'instances-modal', 'add-instance-modal', 'skin-modal', 'snapshots-modal'];
        let activeModal = null;
        for (const id of modals) {
            const m = document.getElementById(id);
            if (m && m.style.display === 'flex') {
                activeModal = m;
                break;
            }
        }

        const allItems = Array.from(document.querySelectorAll('.nav-item'));
        return allItems.filter(item => {
            if (activeModal) {
                return activeModal.contains(item) && item.offsetParent !== null;
            }
            let parent = item.parentElement;
            while (parent) {
                if (parent.classList?.contains('modal-overlay') && parent.style.display !== 'flex') return false;
                parent = parent.parentElement;
            }
            return item.offsetParent !== null;
        });
    },

    navigate(direction) {
        const current = document.activeElement;
        const items = this.getVisibleNavItems();

        if (!items.includes(current)) {
            items[0]?.focus();
            return;
        }

        const currentRect = current.getBoundingClientRect();
        const cx = currentRect.left + currentRect.width / 2;
        const cy = currentRect.top + currentRect.height / 2;

        let bestMatch = null;
        let minScore = Infinity;

        items.forEach(item => {
            if (item === current) return;
            const rect = item.getBoundingClientRect();
            const ix = rect.left + rect.width / 2;
            const iy = rect.top + rect.height / 2;

            const dx = ix - cx;
            const dy = iy - cy;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;

            let inDirection = false;
            if (direction === 'right' && angle >= -45 && angle <= 45) inDirection = true;
            if (direction === 'left' && (angle >= 135 || angle <= -135)) inDirection = true;
            if (direction === 'down' && angle > 45 && angle < 135) inDirection = true;
            if (direction === 'up' && angle < -45 && angle > -135) inDirection = true;

            if (inDirection) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                const penalty = (direction === 'left' || direction === 'right') ? Math.abs(dy) * 2.5 : Math.abs(dx) * 2.5;
                const score = distance + penalty;

                if (score < minScore) {
                    minScore = score;
                    bestMatch = item;
                }
            }
        });

        if (bestMatch) {
            bestMatch.focus();
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    clickActive() {
        const active = document.activeElement;
        if (active && active.classList.contains('nav-item')) {
            active.classList.add('active-bump');
            setTimeout(() => active.classList.remove('active-bump'), 100);

            if (active.id === 'version-select-box') {
                this.cycleActiveSelection(1);
                return;
            }
            if (active.id === 'classic-version-select-box') {
                const classicSelect = document.getElementById('classic-version-select');
                if (classicSelect) {
                    classicSelect.selectedIndex = (classicSelect.selectedIndex + 1) % classicSelect.options.length;
                    syncVersionFromClassic();
                }
                return;
            }
            if (active.id === 'compat-select-box') {
                this.cycleActiveSelection(1);
                return;
            }

            if (active.tagName === 'INPUT' && active.type === 'checkbox') {
                active.checked = !active.checked;
                active.dispatchEvent(new Event('change'));
            } else {
                active.click();
            }
        }
    },

    cancelCurrent() {
        const activeModal = this.getActiveModal();
        if (activeModal) {
            if (activeModal.id === 'options-modal') toggleOptions(false);
            else if (activeModal.id === 'profile-modal') toggleProfile(false);
            else if (activeModal.id === 'servers-modal') toggleServers(false);
            else if (activeModal.id === 'instances-modal') toggleInstances(false);
            else if (activeModal.id === 'add-instance-modal') toggleAddInstance(false);
            else if (activeModal.id === 'update-modal') document.getElementById('btn-skip-update')?.click();
            else if (activeModal.id === 'skin-modal') closeSkinManager();
            else if (activeModal.id === 'snapshots-modal') toggleSnapshots(false);
        }
    },

    getActiveModal() {
        const modals = ['update-modal', 'options-modal', 'profile-modal', 'servers-modal', 'instances-modal', 'add-instance-modal', 'skin-modal', 'snapshots-modal'];
        for (const id of modals) {
            const m = document.getElementById(id);
            if (m && m.style.display === 'flex') return m;
        }
        return null;
    },

    cycleActiveSelection(dir) {
        const active = document.activeElement;
        if (active && active.id === 'version-select-box') {
            const select = document.getElementById('version-select');
            if (select) {
                let newIdx = select.selectedIndex + dir;
                if (newIdx < 0) newIdx = select.options.length - 1;
                if (newIdx >= select.options.length) newIdx = 0;
                select.selectedIndex = newIdx;
                updateSelectedRelease();
            }
        } else if (active && active.id === 'compat-select-box') {
            const select = document.getElementById('compat-select');
            if (select) {
                let newIdx = select.selectedIndex + dir;
                if (newIdx < 0) newIdx = select.options.length - 1;
                if (newIdx >= select.options.length) newIdx = 0;
                select.selectedIndex = newIdx;
                updateCompatDisplay();
            }
        } else if (!this.getActiveModal()) {
            const select = document.getElementById('version-select');
            if (select) {
                let newIdx = select.selectedIndex + dir;
                if (newIdx < 0) newIdx = select.options.length - 1;
                if (newIdx >= select.options.length) newIdx = 0;
                select.selectedIndex = newIdx;
                updateSelectedRelease();
            }
        }
    },

    scrollActive(val) {
        const serverList = document.getElementById('servers-list-container');
        const instanceList = document.getElementById('instances-list-container');
        const snapshotList = document.getElementById('snapshots-list-container');
        if (this.getActiveModal()?.id === 'servers-modal' && serverList) {
            serverList.scrollTop += val;
        } else if (this.getActiveModal()?.id === 'instances-modal' && instanceList) {
            instanceList.scrollTop += val;
        } else if (this.getActiveModal()?.id === 'snapshots-modal' && snapshotList) {
            snapshotList.scrollTop += val;
        } else if (!this.getActiveModal()) {
            const sidebar = document.getElementById('updates-list')?.parentElement;
            if (sidebar) sidebar.scrollTop += val;
        }
    }
};

const UiSoundManager = {
    files: {
        cursor: 'JDSherbert - Ultimate UI SFX Pack - Cursor - 1.mp3',
        select: 'JDSherbert - Ultimate UI SFX Pack - Select - 1.mp3',
        cancel: 'JDSherbert - Ultimate UI SFX Pack - Cancel - 1.mp3',
        popupOpen: 'JDSherbert - Ultimate UI SFX Pack - Popup Open - 1.mp3',
        popupClose: 'JDSherbert - Ultimate UI SFX Pack - Popup Close - 1.mp3',
        error: 'JDSherbert - Ultimate UI SFX Pack - Error - 1.mp3'
    },
    cache: {},
    lastPlayedAt: {},
    cooldownMs: 70,
    lastHoverItem: null,
    inputSource: 'mouse',

    setInputSource(source) {
        this.inputSource = source;
    },

    shouldPlay() {
        return this.inputSource === 'controller';
    },

    init() {
        Object.entries(this.files).forEach(([key, file]) => {
            this.cache[key] = new Audio(file);
            this.cache[key].preload = 'auto';
            this.cache[key].volume = key === 'cursor' ? 0.45 : 0.6;
        });

        const markMouseInput = () => this.setInputSource('mouse');
        ['mousemove', 'mousedown', 'touchstart', 'wheel', 'keydown'].forEach((ev) => {
            document.addEventListener(ev, markMouseInput, { passive: true });
        });

        document.addEventListener('focusin', (e) => {
            if (e.target?.classList?.contains('nav-item')) this.play('cursor');
        });

        document.addEventListener('pointerover', (e) => {
            const navItem = e.target?.closest?.('.nav-item');
            if (!navItem || navItem === this.lastHoverItem) return;
            this.lastHoverItem = navItem;
            this.play('cursor');
        });

        document.addEventListener('pointerleave', () => {
            this.lastHoverItem = null;
        });

        document.addEventListener('click', (e) => {
            const navItem = e.target?.closest?.('.nav-item');
            if (!navItem) return;
            const label = (navItem.textContent || '').trim().toLowerCase();
            if (label.includes('cancel') || label.includes('close') || label.includes('back') || label.includes('later')) {
                this.play('cancel');
                return;
            }
            this.play('select');
        });
    },

    play(name) {
        if (!this.shouldPlay()) return;
        const now = Date.now();
        if (this.lastPlayedAt[name] && now - this.lastPlayedAt[name] < this.cooldownMs) return;
        this.lastPlayedAt[name] = now;

        const audio = this.cache[name];
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {});
    },

    playToast(message) {
        const normalized = String(message || '').toLowerCase();
        if (normalized.includes('error') || normalized.includes('failed') || normalized.includes('missing') || normalized.includes('required')) {
            this.play('error');
        }
    }
};

const MusicManager = {
    audio: new Audio(),
    playlist: [],
    currentIndex: -1,
    enabled: false,

    async init() {
        this.enabled = await Store.get('legacy_music_enabled', true);
        this.audio.volume = await Store.get('legacy_music_volume', 0.5);
        this.updateIcon();
        this.audio.onended = () => this.playNext();
        if (this.enabled) {
            this.start();
        }
        
        const slider = document.getElementById('volume-slider');
        if (slider) {
            slider.value = this.audio.volume;
            slider.oninput = async () => {
                this.audio.volume = slider.value;
                await Store.set('legacy_music_volume', this.audio.volume);
            };
        }
    },

    async scan() {
        try {
            const installDir = await getInstallDir();
            const musicPath = path.join(installDir, 'music', 'music');
            
            if (fs.existsSync(musicPath)) {
                const files = fs.readdirSync(musicPath);
                this.playlist = files
                    .filter(f => f.toLowerCase().endsWith('.ogg'))
                    .map(f => path.join(musicPath, f));
                
                for (let i = this.playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
                }
                return this.playlist.length > 0;
            }
        } catch (e) {
            console.error("Music scan error:", e);
        }
        return false;
    },

    async start() {
        if (this.playlist.length === 0) {
            const success = await this.scan();
            if (!success) return;
        }
        if (this.playlist.length > 0 && this.audio.paused) {
            this.playNext();
        }
    },

    playNext() {
        if (!this.enabled || this.playlist.length === 0) return;
        
        let nextIndex;
        if (this.playlist.length > 1) {
            do {
                nextIndex = Math.floor(Math.random() * this.playlist.length);
            } while (nextIndex === this.currentIndex);
        } else {
            nextIndex = 0;
        }
        
        this.currentIndex = nextIndex;
        this.audio.src = `file://${this.playlist[this.currentIndex]}`;
        this.audio.play().catch(e => {
            console.error("Audio playback error:", e);
            setTimeout(() => this.playNext(), 1000);
        });
    },

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
    },

    async toggle() {
        this.enabled = !this.enabled;
        await Store.set('legacy_music_enabled', this.enabled);
        this.updateIcon();
        if (this.enabled) {
            this.start();
        } else {
            this.stop();
        }
    },

    updateIcon() {
        const btn = document.getElementById('music-toggle');
        if (!btn) return;
        if (this.enabled) {
            btn.classList.remove('muted');
        } else {
            btn.classList.add('muted');
        }
    }
};

async function migrateLegacyConfig() {
    const hasInstances = await Store.get('legacy_instances', null);
    if (!hasInstances) {
        const repo = await Store.get('legacy_repo', DEFAULT_REPO);
        const exec = await Store.get('legacy_exec_path', DEFAULT_EXEC);
        const ip = await Store.get('legacy_ip', "");
        const port = await Store.get('legacy_port', "");
        const isServer = await Store.get('legacy_is_server', false);
        const compat = await Store.get('legacy_compat_layer', 'direct');
        const installDir = await Store.get('legacy_install_path', path.join(require('os').homedir(), 'Documents', 'LegacyClient'));
        const installedTag = await Store.get('installed_version_tag', null);

        const defaultInstance = {
            id: 'instance-' + Date.now(),
            name: "Default Instance",
            repo: repo,
            execPath: exec,
            ip: ip,
            port: port,
            isServer: isServer,
            compatLayer: compat,
            installPath: installDir,
            installedTag: installedTag
        };

        instances = [defaultInstance];
        currentInstanceId = defaultInstance.id;
        await Store.set('legacy_instances', instances);
        await Store.set('legacy_current_instance_id', currentInstanceId);
    } else {
        instances = hasInstances;
        currentInstanceId = await Store.get('legacy_current_instance_id', instances[0].id);
    }
    
    currentInstance = instances.find(i => i.id === currentInstanceId) || instances[0];
}

function isSteamDeckEnvironment() {
    if (process.platform !== 'linux') return false;

    const env = process.env || {};
    if (env.STEAMDECK === '1' || env.SteamDeck === '1') return true;

    try {
        const osRelease = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
        if (osRelease.includes('steamos') || osRelease.includes('steam deck')) return true;
    } catch (_) {}

    return false;
}

function focusPrimaryPlayButton() {
    const classicPlayBtn = document.getElementById('classic-btn-play');
    const mainPlayBtn = document.getElementById('btn-play-main');
    const target = (classicPlayBtn && classicPlayBtn.offsetParent !== null) ? classicPlayBtn : mainPlayBtn;
    if (!target) return;

    target.focus();
    target.classList.add('controller-active');
    setTimeout(() => target.classList.remove('controller-active'), 180);
}

function syncRepoPresetFromInput() {
    const presetSelect = document.getElementById('repo-preset-select');
    const repoInput = document.getElementById('repo-input');
    if (!presetSelect || !repoInput) return;

    if (repoInput.value.trim() === REPO_PRESETS.default) presetSelect.value = REPO_PRESETS.default;
    else if (repoInput.value.trim() === REPO_PRESETS.noWatermark) presetSelect.value = REPO_PRESETS.noWatermark;
    else presetSelect.value = 'custom';
}

function applyRepoPreset() {
    const presetSelect = document.getElementById('repo-preset-select');
    const repoInput = document.getElementById('repo-input');
    if (!presetSelect || !repoInput) return;
    if (presetSelect.value === 'custom') return;
    repoInput.value = presetSelect.value;
}


function applyControllerLayoutPresetState(layoutMode = 'auto') {
    const presets = document.querySelectorAll('.controller-layout-preset');
    const activeLayout = layoutMode === 'nintendo' ? 'nintendo' : 'xbox';
    presets.forEach((preset) => {
        const isActive = preset.dataset.layout === activeLayout;
        preset.classList.toggle('active', isActive);
        preset.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function initControllerLayoutPresets() {
    const layoutSelect = document.getElementById('controller-layout-select');
    if (!layoutSelect) return;

    const presets = document.querySelectorAll('.controller-layout-preset');
    presets.forEach((preset) => {
        const pressOn = () => preset.classList.add('is-pressed');
        const pressOff = () => preset.classList.remove('is-pressed');

        preset.addEventListener('pointerdown', pressOn);
        preset.addEventListener('pointerup', pressOff);
        preset.addEventListener('pointerleave', pressOff);
        preset.addEventListener('blur', pressOff);

        preset.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') pressOn();
        });
        preset.addEventListener('keyup', (event) => {
            if (event.key === 'Enter' || event.key === ' ') pressOff();
        });

        preset.addEventListener('click', () => {
            const selectedLayout = preset.dataset.layout || 'xbox';
            layoutSelect.value = selectedLayout;
            applyControllerLayoutPresetState(selectedLayout);
        });
    });

    layoutSelect.addEventListener('change', () => {
        applyControllerLayoutPresetState(layoutSelect.value || 'auto');
    });

    applyControllerLayoutPresetState(layoutSelect.value || 'auto');
}

window.onload = async () => {
    try {
        await migrateLegacyConfig();
        
        const repoInput = document.getElementById('repo-input');
        const execInput = document.getElementById('exec-input');
        const usernameInput = document.getElementById('username-input');
        const ipInput = document.getElementById('ip-input');
        const portInput = document.getElementById('port-input');
        const serverCheck = document.getElementById('server-checkbox');
        const installInput = document.getElementById('install-path-input');
        const controllerLayoutSelect = document.getElementById('controller-layout-select');

        if (repoInput) {
            repoInput.value = currentInstance.repo;
            repoInput.addEventListener('input', syncRepoPresetFromInput);
        }
        if (execInput) execInput.value = currentInstance.execPath;
        if (usernameInput) usernameInput.value = await Store.get('legacy_username', "");
        if (ipInput) ipInput.value = currentInstance.ip;
        if (portInput) portInput.value = currentInstance.port;
        if (serverCheck) serverCheck.checked = currentInstance.isServer;
        if (installInput) installInput.value = currentInstance.installPath;
        if (controllerLayoutSelect) controllerLayoutSelect.value = await Store.get('legacy_controller_layout_mode', 'auto');
        initControllerLayoutPresets();
        syncRepoPresetFromInput();
        
        if (process.platform === 'linux' || process.platform === 'darwin') {
            const compatContainer = document.getElementById('compat-option-container');
            if (compatContainer) {
                compatContainer.style.display = 'block';
                scanCompatibilityLayers();
            }
        } else {
            currentInstance.compatLayer = 'direct';
            await saveInstancesToStore();
        }

        ipcRenderer.on('window-is-maximized', (event, isMaximized) => {
            const btn = document.getElementById('maximize-btn');
            if (btn) btn.textContent = isMaximized ? '❐' : '▢';
        });

        // Initialize features
        await loadTheme();
        await loadSteamDeckMode();
        await loadControllerLayoutMode();
        fetchGitHubData();
        checkForLauncherUpdates();
        loadSplashText();
        MusicManager.init();
        GamepadManager.init();
        UiSoundManager.init();

        if (isSteamDeckEnvironment()) {
            ipcRenderer.send('window-set-fullscreen', true);
            setTimeout(() => focusPrimaryPlayButton(), 150);
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'F9') {
                checkForLauncherUpdates(true);
            }
            if (e.key === 'F11') {
                e.preventDefault();
                ipcRenderer.send('window-fullscreen');
            }
        });

        window.addEventListener('online', () => {
            document.getElementById('offline-indicator').style.display = 'none';
            showToast("Back Online! Refreshing...");
            fetchGitHubData();
        });

        window.addEventListener('offline', () => {
            document.getElementById('offline-indicator').style.display = 'block';
            showToast("Connection Lost. Entering Offline Mode.");
        });

        if (!navigator.onLine) {
            document.getElementById('offline-indicator').style.display = 'block';
        }
    } catch (e) {
        console.error("Startup error:", e);
        // Hide loader anyway so user isn't stuck
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
        showToast("Error during startup: " + e.message);
    }
};

async function saveInstancesToStore() {
    await Store.set('legacy_instances', instances);
    await Store.set('legacy_current_instance_id', currentInstanceId);
}

async function toggleInstances(show) {
    if (isProcessing) return;
    const modal = document.getElementById('instances-modal');
    if (show) {
        await renderInstancesList();
        document.activeElement?.blur();
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
    } else {
        modal.style.opacity = '0';
        UiSoundManager.play('popupClose');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

async function renderInstancesList() {
    const container = document.getElementById('instances-list-container');
    container.innerHTML = '';

    if (instances.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">No instances found.</div>';
        return;
    }

    instances.forEach((inst) => {
        const isActive = inst.id === currentInstanceId;
        const item = document.createElement('div');
        item.className = `flex justify-between items-center p-4 border-b border-[#333] hover:bg-[#111] ${isActive ? 'bg-[#1a1a1a] border-l-4 border-l-[#55ff55]' : ''}`;
        
        item.innerHTML = `
            <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                    <span class="text-white text-xl font-bold">${inst.name}</span>
                    ${isActive ? '<span class="text-[10px] bg-[#55ff55] text-black px-1 font-bold">ACTIVE</span>' : ''}
                </div>
                <span class="text-gray-400 text-sm font-mono">${inst.repo}</span>
                <span class="text-gray-500 text-xs">${inst.installPath}</span>
            </div>
            <div class="flex gap-2">
                <div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="openSnapshotsManager('${inst.id}')">BACKUPS</div>
                ${!isActive ? `<div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="switchInstance('${inst.id}')">SWITCH</div>` : ''}
                <div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="deleteInstance('${inst.id}')" style="${isActive ? 'opacity: 0.5; pointer-events: none;' : ''}">DELETE</div>
            </div>
        `;
        container.appendChild(item);
    });
}

function toggleAddInstance(show) {
    const modal = document.getElementById('add-instance-modal');
    if (show) {
        document.getElementById('new-instance-name').value = '';
        document.getElementById('new-instance-repo').value = DEFAULT_REPO;
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
    } else {
        modal.style.opacity = '0';
        UiSoundManager.play('popupClose');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

function createNewInstance() {
    toggleAddInstance(true);
}

async function saveNewInstance() {
    const name = document.getElementById('new-instance-name').value.trim();
    const repo = document.getElementById('new-instance-repo').value.trim() || DEFAULT_REPO;
    
    if (!name) {
        showToast("Please enter a name for the instance.");
        return;
    }

    const homeDir = require('os').homedir();
    const sanitizedName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const installPath = path.join(homeDir, 'Documents', 'LegacyClient_' + sanitizedName);

    const newInst = {
        id: 'instance-' + Date.now(),
        name: name,
        repo: repo,
        execPath: DEFAULT_EXEC,
        ip: "",
        port: "",
        isServer: false,
        compatLayer: 'direct',
        installPath: installPath,
        installedTag: null
    };

    instances.push(newInst);
    await saveInstancesToStore();
    toggleAddInstance(false);
    renderInstancesList();
    showToast("Instance Created!");
}

async function switchInstance(id) {
    if (isProcessing || id === currentInstanceId) return;
    
    currentInstanceId = id;
    currentInstance = instances.find(i => i.id === currentInstanceId);
    await saveInstancesToStore();
    
    document.getElementById('repo-input').value = currentInstance.repo;
    syncRepoPresetFromInput();
    document.getElementById('exec-input').value = currentInstance.execPath;
    document.getElementById('ip-input').value = currentInstance.ip;
    document.getElementById('port-input').value = currentInstance.port;
    document.getElementById('server-checkbox').checked = currentInstance.isServer;
    document.getElementById('install-path-input').value = currentInstance.installPath;
    
    if (process.platform === 'linux' || process.platform === 'darwin') {
        scanCompatibilityLayers();
    }
    
    renderInstancesList();
    showToast("Switched to " + currentInstance.name);
    fetchGitHubData();
    loadSplashText();
    
    if (window.loadMainMenuSkin) window.loadMainMenuSkin();
}

async function deleteInstance(id) {
    if (id === currentInstanceId) return;
    
    if (confirm("Are you sure you want to delete this instance profile? (Files on disk will NOT be deleted)")) {
        instances = instances.filter(i => i.id !== id);
        await saveInstancesToStore();
        renderInstancesList();
        showToast("Instance Deleted");
    }
}

async function getInstallDir() {
    return currentInstance.installPath;
}

async function browseInstallDir() {
    const dir = await Store.selectDirectory();
    if (dir) {
        document.getElementById('install-path-input').value = dir;
    }
}

async function openGameDir() {
    const dir = await getInstallDir();
    if (fs.existsSync(dir)) {
        shell.openPath(dir);
    } else {
        showToast("Directory does not exist yet!");
    }
}

async function getInstalledPath() {
    return path.join(currentInstance.installPath, currentInstance.execPath);
}

async function checkIsInstalled(tag) {
    const fullPath = await getInstalledPath();
    return fs.existsSync(fullPath) && currentInstance.installedTag === tag;
}

async function updatePlayButtonText() {
    const btn = document.getElementById('btn-play-main');
    const classicBtn = document.getElementById('classic-btn-play');
    if (!btn || isProcessing) return;

    let label, disabled, running;

    if (isGameRunning) {
        label = "GAME RUNNING"; running = true; disabled = false;
    } else {
        running = false;
        if (releasesData.length === 0) {
            const fullPath = await getInstalledPath();
            if (currentInstance.installedTag && fs.existsSync(fullPath)) {
                label = "PLAY"; disabled = false;
            } else {
                label = "OFFLINE"; disabled = true;
            }
        } else {
            const release = releasesData[currentReleaseIndex];
            if (!release) {
                label = "PLAY"; disabled = false;
            } else if (await checkIsInstalled(release.tag_name)) {
                label = "PLAY"; disabled = false;
            } else {
                const fullPath = await getInstalledPath();
                label = fs.existsSync(fullPath) ? "UPDATE" : "INSTALL";
                disabled = false;
            }
        }
    }

    [btn, classicBtn].forEach(b => {
        if (!b) return;
        b.textContent = label;
        b.classList.toggle('running', running);
        if (disabled) b.classList.add('disabled'); else b.classList.remove('disabled');
    });
}

function setGameRunning(running) {
    isGameRunning = running;
    updatePlayButtonText();
}

async function monitorProcess(proc) {
    if (!proc) return;
    const sessionStart = Date.now();
    setGameRunning(true);
    MusicManager.stop();

    proc.on('exit', async () => {
        const sessionDuration = Math.floor((Date.now() - sessionStart) / 1000);
        const playtime = await Store.get('legacy_playtime', 0);
        await Store.set('legacy_playtime', playtime + sessionDuration);
        setGameRunning(false);
        if (MusicManager.enabled) MusicManager.start();
    });
    proc.on('error', (err) => {
        console.error("Process error:", err);
        setGameRunning(false);
        if (MusicManager.enabled) MusicManager.start();
    });
}

function minimizeWindow() {
    ipcRenderer.send('window-minimize');
}

function toggleMaximize() {
    ipcRenderer.send('window-maximize');
}

function closeWindow() {
    ipcRenderer.send('window-close');
}

async function fetchGitHubData() {
    const repo = currentInstance.repo;
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const offlineInd = document.getElementById('offline-indicator');

    if (loader) loader.style.display = 'flex';
    if (loaderText) loaderText.textContent = "SYNCING: " + repo;

    const hideLoader = () => {
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => { loader.style.display = 'none'; }, 300);
        }
    };

    if (!navigator.onLine) {
        console.log("Offline detected, skipping GitHub sync.");
        if (offlineInd) offlineInd.style.display = 'block';
        handleOfflineData();
        setTimeout(hideLoader, 500);
        return;
    }

    try {
        const [relRes, commRes] = await Promise.all([
            fetch(`https://api.github.com/repos/${repo}/releases`),
            fetch(`https://api.github.com/repos/${repo}/commits`)
        ]);

        if (!relRes.ok || !commRes.ok) throw new Error("Rate Limited or API Error");

        releasesData = await relRes.json();
        commitsData = await commRes.json();

        populateVersions();
        populateUpdatesSidebar();

        setTimeout(hideLoader, 500);
    } catch (err) {
        console.error("Fetch error:", err);
        if (loaderText) loaderText.textContent = "REPO NOT FOUND OR API ERROR";
        
        // Even if we fail due to some API error, we should still allow offline play if installed
        handleOfflineData();
        
        showToast("Entering Offline Mode.");
        if (offlineInd) offlineInd.style.display = 'block';
        setTimeout(hideLoader, 2500);
    }
}

function handleOfflineData() {
    releasesData = [];
    commitsData = [];
    populateVersions();
    populateUpdatesSidebar();
}

function populateVersions() {
    const select = document.getElementById('version-select');
    const display = document.getElementById('current-version-display');
    if (!select) return;
    select.innerHTML = '';

    if(releasesData.length === 0) {
        // Check if we have a local version installed
        if (currentInstance.installedTag) {
            const opt = document.createElement('option');
            opt.value = 0;
            opt.textContent = `Installed (${currentInstance.installedTag})`;
            select.appendChild(opt);
            if (display) display.textContent = opt.textContent;
        } else {
            if (display) display.textContent = "No Connection / No Install";
        }
        updatePlayButtonText();
        return;
    }

    releasesData.forEach((rel, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = `Legacy (${rel.tag_name})`;
        select.appendChild(opt);
        if(index === 0 && display) display.textContent = opt.textContent;
    });
    currentReleaseIndex = 0;
    syncClassicVersionSelect();
    updatePlayButtonText();
}

function populateUpdatesSidebar() {
    const list = document.getElementById('updates-list');
    if (!list) return;
    list.innerHTML = '';

    if (commitsData.length === 0) {
        list.innerHTML = '<div class="update-item">No recent activity found.</div>';
        return;
    }

    commitsData.slice(0, 20).forEach((c) => {
        const item = document.createElement('div');
        item.className = 'update-item patch-note-card commit-card';
        const date = new Date(c.commit.author.date).toLocaleString();
        const shortSha = c.sha.substring(0, 7);
        const message = c.commit.message;
        item.innerHTML = `
            <div class="pn-header">
                <span class="update-date">${date}</span>
                <span class="commit-sha">#${shortSha}</span>
            </div>
            <div class="pn-body commit-msg">${message}</div>
        `;
        list.appendChild(item);
    });
}

function updateSelectedRelease() {
    const select = document.getElementById('version-select');
    if (!select) return;
    currentReleaseIndex = select.value;
    document.getElementById('current-version-display').textContent = select.options[select.selectedIndex].text;
    syncClassicVersionSelect();
    updatePlayButtonText();
}

async function launchGame() {
    if (isProcessing || isGameRunning) return;

    if (!navigator.onLine || releasesData.length === 0) {
        const fullPath = await getInstalledPath();
        if (currentInstance.installedTag && fs.existsSync(fullPath)) {
            setProcessingState(true);
            updateProgress(100, "Offline Launch...");
            await launchLocalClient();
            setProcessingState(false);
        } else {
            showToast("You need an internet connection to install the game!");
        }
        return;
    }

    const release = releasesData[currentReleaseIndex];
    if (!release) return;
    const asset = release.assets.find(a => a.name === TARGET_FILE);
    if (!asset) {
        showToast("ZIP Asset missing in this version!");
        return;
    }
    const isInstalled = await checkIsInstalled(release.tag_name);
    if (isInstalled) {
        setProcessingState(true);
        updateProgress(100, "Launching...");
        await launchLocalClient();
        setProcessingState(false);
    } else {
        const fullPath = await getInstalledPath();
        if (fs.existsSync(fullPath)) {
            const choice = await promptUpdate(release.tag_name);
            if (choice === 'update') {
                setProcessingState(true);
                await handleElectronFlow(asset.browser_download_url);
                setProcessingState(false);
            } else if (choice === 'launch') {
                setProcessingState(true);
                updateProgress(100, "Launching Existing...");
                await launchLocalClient();
                setProcessingState(false);
            }
        } else {
            setProcessingState(true);
            await handleElectronFlow(asset.browser_download_url);
            setProcessingState(false);
        }
    }
    updatePlayButtonText();
}

async function promptUpdate(newTag) {
    return new Promise(async (resolve) => {
        const modal = document.getElementById('update-modal');
        const confirmBtn = document.getElementById('btn-confirm-update');
        const skipBtn = document.getElementById('btn-skip-update');
        const closeBtn = document.getElementById('btn-close-update');
        const modalText = document.getElementById('update-modal-text');
        document.activeElement?.blur();
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
        const cleanup = (result) => {
            modal.style.opacity = '0';
            UiSoundManager.play('popupClose');
            setTimeout(() => {
                modal.style.display = 'none';
                if (modalText) modalText.style.display = 'none';
            }, 300);
            confirmBtn.onclick = null;
            skipBtn.onclick = null;
            closeBtn.onclick = null;
            resolve(result);
        };
        confirmBtn.onclick = () => cleanup('update');
        skipBtn.onclick = () => cleanup('launch');
        closeBtn.onclick = () => cleanup('cancel');
    });
}

async function checkForUpdatesManual() {
    const rel = releasesData[currentReleaseIndex];
    if (!rel) {
        showToast("No releases loaded yet");
        return;
    }
    const asset = rel.assets.find(a => a.name === TARGET_FILE);
    if (!asset) {
        showToast("ZIP Asset missing in this version!");
        return;
    }
    const choice = await promptUpdate(rel.tag_name);
    if (choice === 'update') {
        setProcessingState(true);
        await handleElectronFlow(asset.browser_download_url);
        setProcessingState(false);
    } else if (choice === 'launch') {
        setProcessingState(true);
        updateProgress(100, "Launching Existing...");
        await launchLocalClient();
        setProcessingState(false);
    }
    updatePlayButtonText();
}

async function launchLocalClient() {
    const fullPath = await getInstalledPath();
    if (!fs.existsSync(fullPath)) throw new Error("Executable not found! Try reinstalling.");
    if (process.platform !== 'win32') {
        try { fs.chmodSync(fullPath, 0o755); } catch (e) { console.warn("Failed to set executable permissions:", e); }
    }
    return new Promise(async (resolve, reject) => {
        const username = await Store.get('legacy_username', "");
        const ip = currentInstance.ip;
        const port = currentInstance.port;
        const isServer = currentInstance.isServer;
        let args = [];
        if (username) args.push("-name", username);
        if (isServer) args.push("-server");
        if (ip) args.push("-ip", ip);
        if (port) args.push("-port", port);
        const argString = args.map(a => `"${a}"`).join(" ");
        let cmd = `"${fullPath}" ${argString}`;
        if (process.platform === 'linux' || process.platform === 'darwin') {
            let compat = currentInstance.compatLayer;
            if (compat === 'custom' && currentInstance.customCompatPath) {
                compat = currentInstance.customCompatPath;
            }
            
            if (compat === 'wine64' || compat === 'wine') cmd = `${compat} "${fullPath}" ${argString}`;
            else if (compat.includes('Proton') || compat.includes('/proton') || (currentInstance.compatLayer === 'custom' && currentInstance.customCompatPath)) {
                const prefix = path.join(path.dirname(fullPath), 'pfx');
                if (!fs.existsSync(prefix)) fs.mkdirSync(prefix, { recursive: true });
                cmd = `STEAM_COMPAT_CLIENT_INSTALL_PATH="" STEAM_COMPAT_DATA_PATH="${prefix}" "${compat}" run "${fullPath}" ${argString}`;
            }
        }
        const startTime = Date.now();
        const proc = childProcess.exec(cmd, (error) => {
            const duration = Date.now() - startTime;
            if (error && duration < 2000) { showToast("Failed to launch: " + error.message); reject(error); }
            else resolve();
        });
        monitorProcess(proc);
    });
}

function setProcessingState(active) {
    isProcessing = active;
    const playBtn = document.getElementById('btn-play-main');
    const classicPlayBtn = document.getElementById('classic-btn-play');
    const optionsBtn = document.getElementById('btn-options');
    const progressContainer = document.getElementById('progress-container');
    if (active) {
        if (playBtn) playBtn.classList.add('disabled');
        if (classicPlayBtn) classicPlayBtn.classList.add('disabled');
        if (optionsBtn) optionsBtn.classList.add('disabled');
        if (progressContainer) progressContainer.style.display = 'flex';
        updateProgress(0, "Preparing...");
    } else {
        if (playBtn) playBtn.classList.remove('disabled');
        if (classicPlayBtn) classicPlayBtn.classList.remove('disabled');
        if (optionsBtn) optionsBtn.classList.remove('disabled');
        if (progressContainer) progressContainer.style.display = 'none';
    }
}

function updateProgress(percent, text) {
    const bar = document.getElementById('progress-bar-fill');
    if (bar) bar.style.width = percent + "%";
    const txt = document.getElementById('progress-text');
    if (text && txt) txt.textContent = text;
}

async function handleElectronFlow(url) {
    try {
        const extractDir = currentInstance.installPath;
        const parentDir = path.dirname(extractDir);
        const zipPath = path.join(parentDir, TARGET_FILE);
        const backupDir = path.join(parentDir, 'LegacyClient_Backup');

        // Snapshot before update
        if (fs.existsSync(extractDir)) {
            updateProgress(0, "Snapshotting Instance...");
            await createSnapshot(currentInstance);
        }

        updateProgress(5, "Downloading " + TARGET_FILE + "...");
        await downloadFile(url, zipPath);
        updateProgress(75, "Extracting Archive...");
        const preserveList = ['options.txt', 'servers.txt', 'username.txt', 'settings.dat', 'UID.dat', path.join('Windows64', 'GameHDD'), path.join('Common', 'res', 'mob', 'char.png')];
        if (fs.existsSync(extractDir)) {
            if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
            fs.mkdirSync(backupDir, { recursive: true });
            for (const item of preserveList) {
                const src = path.join(extractDir, item);
                const dest = path.join(backupDir, item);
                if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(src, dest); }
            }
            try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) { console.warn("Cleanup error:", e); }
        }
        if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
        await extractZip(zipPath, { dir: extractDir });
        await MusicManager.scan();
        if (MusicManager.enabled) MusicManager.start();
        if (fs.existsSync(backupDir)) {
            for (const item of preserveList) {
                const src = path.join(backupDir, item);
                const dest = path.join(extractDir, item);
                if (fs.existsSync(src)) {
                    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.renameSync(src, dest);
                }
            }
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
        const fullPath = await getInstalledPath();
        if (!fs.existsSync(fullPath)) { showToast("Executable not found at: " + currentInstance.execPath); return; }
        updateProgress(100, "Launching...");
        currentInstance.installedTag = releasesData[currentReleaseIndex].tag_name;
        await saveInstancesToStore();
        await new Promise(r => setTimeout(r, 800));
        await launchLocalClient();
    } catch (e) { showToast("Error: " + e.message); }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (e) {}
        const file = fs.createWriteStream(destPath);
        let totalSize = 0; let downloadedSize = 0;
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) { downloadFile(response.headers.location, destPath).then(resolve).catch(reject); return; }
            totalSize = parseInt(response.headers['content-length'], 10);
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                const percent = Math.floor((downloadedSize / totalSize) * 70) + 5;
                updateProgress(percent, `Downloading... ${percent}%`);
            });
            response.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
        }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
    });
}

async function toggleOptions(show) {
    if (isProcessing) return;
    const modal = document.getElementById('options-modal');
    if (show) {
        // Sync classic theme checkbox to current state
        const cb = document.getElementById('classic-theme-checkbox');
        if (cb) cb.checked = document.body.classList.contains('classic-theme');
        const steamDeckCb = document.getElementById('steamdeck-mode-checkbox');
        if (steamDeckCb) steamDeckCb.checked = document.body.classList.contains('steamdeck-mode');
        const layoutSelect = document.getElementById('controller-layout-select');
        if (layoutSelect) {
            const savedLayoutMode = await Store.get('legacy_controller_layout_mode', 'auto');
            layoutSelect.value = savedLayoutMode;
            GamepadManager.setControlLayoutMode(savedLayoutMode);
            applyControllerLayoutPresetState(savedLayoutMode);
        }
        syncRepoPresetFromInput();
        document.activeElement?.blur(); modal.style.display = 'flex'; modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
    }
    else { modal.style.opacity = '0'; UiSoundManager.play('popupClose'); setTimeout(() => modal.style.display = 'none', 300); }
}

async function toggleProfile(show) {
    if (isProcessing) return;
    const modal = document.getElementById('profile-modal');
    if (show) { await updatePlaytimeDisplay(); document.activeElement?.blur(); modal.style.display = 'flex'; modal.style.opacity = '1'; UiSoundManager.play('popupOpen'); }
    else { modal.style.opacity = '0'; UiSoundManager.play('popupClose'); setTimeout(() => modal.style.display = 'none', 300); }
}

async function toggleServers(show) {
    if (isProcessing) return;
    const modal = document.getElementById('servers-modal');
    if (show) { await loadServers(); document.activeElement?.blur(); modal.style.display = 'flex'; modal.style.opacity = '1'; UiSoundManager.play('popupOpen'); }
    else { modal.style.opacity = '0'; UiSoundManager.play('popupClose'); setTimeout(() => modal.style.display = 'none', 300); }
}

async function getServersFilePath() { return path.join(currentInstance.installPath, 'servers.txt'); }

async function loadServers() {
    const filePath = await getServersFilePath();
    const container = document.getElementById('servers-list-container');
    if (!container) return;
    container.innerHTML = '';
    if (!fs.existsSync(filePath)) { container.innerHTML = '<div class="text-center text-gray-400 py-4">No servers added yet.</div>'; return; }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l !== '');
        const servers = [];
        for (let i = 0; i < lines.length; i += 3) { if (lines[i] && lines[i+1] && lines[i+2]) servers.push({ ip: lines[i], port: lines[i+1], name: lines[i+2] }); }
        if (servers.length === 0) { container.innerHTML = '<div class="text-center text-gray-400 py-4">No servers added yet.</div>'; return; }
        servers.forEach((s, index) => {
            const item = document.createElement('div');
            item.className = 'flex justify-between items-center p-3 border-b border-[#333] hover:bg-[#111]';
            item.innerHTML = `<div class="flex flex-col"><span class="text-white text-xl">${s.name}</span><span class="text-gray-400 text-sm">${s.ip}:${s.port}</span></div><div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="removeServer(${index})">DELETE</div>`;
            container.appendChild(item);
        });
    } catch (e) { console.error("Failed to load servers:", e); container.innerHTML = '<div class="text-center text-red-400 py-4">Error loading servers.</div>'; }
}

async function addServer() {
    const nameInput = document.getElementById('server-name-input');
    const ipInput = document.getElementById('server-ip-input');
    const portInput = document.getElementById('server-port-input');
    const name = nameInput.value.trim();
    const ip = ipInput.value.trim();
    const port = portInput.value.trim() || "25565";
    if (!name || !ip) { showToast("Name and IP are required!"); return; }
    const filePath = await getServersFilePath();
    const serverEntry = `${ip}\n${port}\n${name}\n`;
    try {
        const dir = path.dirname(filePath); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(filePath, serverEntry);
        nameInput.value = ''; ipInput.value = ''; portInput.value = '';
        showToast("Server Added!"); loadServers();
    } catch (e) { showToast("Failed to save server: " + e.message); }
}

async function removeServer(index) {
    const filePath = await getServersFilePath();
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l !== '');
        const servers = [];
        for (let i = 0; i < lines.length; i += 3) { if (lines[i] && lines[i+1] && lines[i+2]) servers.push({ ip: lines[i], port: lines[i+1], name: lines[i+2] }); }
        servers.splice(index, 1);
        let newContent = ""; servers.forEach(s => { newContent += `${s.ip}\n${s.port}\n${s.name}\n`; });
        fs.writeFileSync(filePath, newContent); loadServers(); showToast("Server Removed");
    } catch (e) { showToast("Failed to remove server: " + e.message); }
}

async function updatePlaytimeDisplay() {
    const el = document.getElementById('playtime-display');
    const playtime = await Store.get('legacy_playtime', 0);
    if (el) el.textContent = formatPlaytime(playtime);
}

function formatPlaytime(seconds) {
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
}

async function saveOptions() {
    const newRepo = document.getElementById('repo-input').value.trim();
    const newExec = document.getElementById('exec-input').value.trim();
    const compatSelect = document.getElementById('compat-select');
    const ip = document.getElementById('ip-input').value.trim();
    const port = document.getElementById('port-input').value.trim();
    const isServer = document.getElementById('server-checkbox').checked;
    const customProtonPath = document.getElementById('custom-proton-path').value.trim();
    const newInstallPath = document.getElementById('install-path-input').value.trim();
    const oldInstallPath = currentInstance.installPath;
    if (newInstallPath && newInstallPath !== oldInstallPath) {
        if (fs.existsSync(oldInstallPath)) {
            const preserveList = ['options.txt', 'servers.txt', 'username.txt', 'settings.dat', 'UID.dat', path.join('Windows64', 'GameHDD'), path.join('Common', 'res', 'mob', 'char.png')];
            if (!fs.existsSync(newInstallPath)) fs.mkdirSync(newInstallPath, { recursive: true });
            for (const item of preserveList) {
                const src = path.join(oldInstallPath, item); const dest = path.join(newInstallPath, item);
                if (fs.existsSync(src)) { const destDir = path.dirname(dest); if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true }); try { if (!fs.existsSync(dest)) fs.renameSync(src, dest); } catch (e) { console.error("Migration error for " + item + ": " + e.message); } }
            }
        }
        currentInstance.installPath = newInstallPath;
    }
    if (newRepo) currentInstance.repo = newRepo;
    if (newExec) currentInstance.execPath = newExec;
    currentInstance.ip = ip; currentInstance.port = port; currentInstance.isServer = isServer;
    if (compatSelect) {
        currentInstance.compatLayer = compatSelect.value;
        currentInstance.customCompatPath = customProtonPath;
    }
    const isClassic = document.getElementById('classic-theme-checkbox')?.checked || false;
    const isSteamDeckMode = document.getElementById('steamdeck-mode-checkbox')?.checked || false;
    const controllerLayoutMode = document.getElementById('controller-layout-select')?.value || 'auto';
    await Store.set('legacy_classic_theme', isClassic);
    await Store.set('legacy_steamdeck_mode', isSteamDeckMode);
    await Store.set('legacy_controller_layout_mode', controllerLayoutMode);
    GamepadManager.setControlLayoutMode(controllerLayoutMode);
    applyControllerLayoutPresetState(controllerLayoutMode);
    applyTheme(isClassic);
    applySteamDeckMode(isSteamDeckMode);
    await saveInstancesToStore(); toggleOptions(false); fetchGitHubData(); updatePlayButtonText(); showToast("Settings Saved");
}

async function saveProfile() {
    let username = document.getElementById('username-input').value.trim();
    if (username.length > 16) {
        username = username.substring(0, 16);
    }
    await Store.set('legacy_username', username);
    updateClassicUsername();
    toggleProfile(false); showToast("Profile Updated");
}

function showToast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    UiSoundManager.playToast(msg);
    t.textContent = msg; t.style.display = 'block'; t.style.animation = 'none'; t.offsetHeight; t.style.animation = 'slideUp 0.3s ease-out';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
}

async function toggleMusic() { await MusicManager.toggle(); }

function scanCompatibilityLayers() {
    const select = document.getElementById('compat-select'); if (!select) return;
    const savedValue = currentInstance.compatLayer;
    const layers = [{ name: 'Default (Direct)', cmd: 'direct' }, { name: 'Wine64', cmd: 'wine64' }, { name: 'Wine', cmd: 'wine' }];

    const seen = new Set(layers.map(l => l.cmd));
    const foundProtonLayers = [];
    const addLayer = (name, cmd) => {
        if (!name || !cmd || seen.has(cmd)) return;
        seen.add(cmd);
        foundProtonLayers.push({ name, cmd });
    };

    const homeDir = require('os').homedir();
    const protonCandidates = [];

    if (process.platform === 'linux') {
        const steamRoots = [
            path.join(homeDir, '.steam', 'steam'),
            path.join(homeDir, '.local', 'share', 'Steam'),
            path.join(homeDir, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')
        ];

        steamRoots.forEach((root) => {
            protonCandidates.push(path.join(root, 'steamapps', 'common'));
            protonCandidates.push(path.join(root, 'compatibilitytools.d'));
        });
    } else if (process.platform === 'darwin') {
        protonCandidates.push(path.join(homeDir, 'Library', 'Application Support', 'Steam', 'steamapps', 'common'));
        protonCandidates.push(path.join(homeDir, 'Library', 'Application Support', 'Steam', 'compatibilitytools.d'));
    }

    const toolNameMatches = (dir) => {
        const n = dir.toLowerCase();
        return n.startsWith('proton') || n.startsWith('ge-proton') || n.includes('proton-ge') || n.includes('wine') || n.includes('crossover') || n.includes('umu-proton');
    };

    for (const basePath of protonCandidates) {
        if (!fs.existsSync(basePath)) continue;
        try {
            const dirs = fs.readdirSync(basePath);
            dirs.forEach((dirName) => {
                if (!toolNameMatches(dirName)) return;
                const protonPath = path.join(basePath, dirName, 'proton');
                if (fs.existsSync(protonPath)) addLayer(dirName, protonPath);
            });
        } catch (e) {
            console.error('Compatibility scan error:', e.message);
        }
    }

    foundProtonLayers.sort((a, b) => {
        const aGe = /(^|\b)(ge-proton|proton-ge|umu-proton)/i.test(a.name) ? 1 : 0;
        const bGe = /(^|\b)(ge-proton|proton-ge|umu-proton)/i.test(b.name) ? 1 : 0;
        if (aGe !== bGe) return bGe - aGe;
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    layers.push(...foundProtonLayers);

    // Add custom option at end so discovered runtimes are easier to browse first.
    layers.push({ name: 'Custom (Linux)', cmd: 'custom' });

    select.innerHTML = '';
    layers.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.cmd;
        opt.textContent = l.name;
        select.appendChild(opt);
        if (l.cmd === savedValue) opt.selected = true;
    });

    // If no saved compat layer or still on direct, prefer the newest detected GE/Proton on Linux.
    if (process.platform === 'linux' && (savedValue === 'direct' || !savedValue) && foundProtonLayers.length > 0) {
        select.value = foundProtonLayers[0].cmd;
    }

    updateCompatDisplay();

    const customPathInput = document.getElementById('custom-proton-path');
    if (customPathInput) customPathInput.value = currentInstance.customCompatPath || "";
}

function updateCompatDisplay() {
    const select = document.getElementById('compat-select'); const display = document.getElementById('current-compat-display');
    const customGroup = document.getElementById('custom-proton-group');
    if (select && display && select.selectedIndex !== -1) {
        display.textContent = select.options[select.selectedIndex].text;
        if (customGroup) customGroup.style.display = select.value === 'custom' ? 'block' : 'none';
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleIcon = document.getElementById('sidebar-toggle-icon');
    const list = document.getElementById('updates-list');

    if (sidebar.classList.contains('collapsed')) {
        list.style.display = 'flex';
        requestAnimationFrame(() => {
            sidebar.classList.remove('collapsed');
            toggleIcon.textContent = '◀';
            toggleIcon.title = 'Collapse Patch Notes';
        });
    } else {
        list.style.display = '';
        sidebar.classList.add('collapsed');
        toggleIcon.textContent = '▶';
        toggleIcon.title = 'Expand Patch Notes';
    }
}

function isNewerVersion(latest, current) {
    const lParts = latest.split('.').map(Number); const cParts = current.split('.').map(Number);
    for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
        const l = lParts[i] || 0; const c = cParts[i] || 0;
        if (l > c) return true; if (l < c) return false;
    }
    return false;
}

async function checkForLauncherUpdates(manual = false) {
    try {
        const currentVersion = require('./package.json').version;
        const res = await fetch(`https://api.github.com/repos/${LAUNCHER_REPO}/releases/latest`);
        if (!res.ok) { if (manual) showToast("Could not check for updates."); return; }
        const latestRelease = await res.json(); const latestVersion = latestRelease.tag_name.replace('v', '');
        if (isNewerVersion(latestVersion, currentVersion)) {
            const updateConfirmed = await promptLauncherUpdate(latestRelease.tag_name, latestRelease.body);
            if (updateConfirmed) downloadAndInstallLauncherUpdate(latestRelease);
        } else if (manual) showToast("Launcher is up to date!");
    } catch (e) { console.error("Launcher update check failed:", e); if (manual) showToast("Update check failed."); }
}

async function promptLauncherUpdate(version, changelog) {
    return new Promise((resolve) => {
        const modal = document.getElementById('update-modal');
        const confirmBtn = document.getElementById('btn-confirm-update');
        const skipBtn = document.getElementById('btn-skip-update');
        const closeBtn = document.getElementById('btn-close-update');
        const modalText = document.getElementById('update-modal-text');
        if (modalText) {
            modalText.innerHTML = `<span class="update-tag">NEW UPDATE: v${version}</span><br><div class="pn-body" style="font-size: 16px; max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 10px; margin-top: 5px;">${changelog || "No changelog provided."}</div>`;
            modalText.style.display = 'block';
        }
        document.activeElement?.blur(); modal.style.display = 'flex'; modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
        const cleanup = (result) => {
            modal.style.opacity = '0'; UiSoundManager.play('popupClose'); setTimeout(() => { modal.style.display = 'none'; if (modalText) modalText.style.display = 'none'; }, 300);
            confirmBtn.onclick = null; skipBtn.onclick = null; closeBtn.onclick = null; resolve(result);
        };
        confirmBtn.onclick = () => cleanup(true); skipBtn.onclick = () => cleanup(false); closeBtn.onclick = () => cleanup(false);
    });
}

async function downloadAndInstallLauncherUpdate(release) {
    setProcessingState(true); updateProgress(0, "Preparing Launcher Update...");
    let assetPattern = "";
    if (process.platform === 'win32') assetPattern = ".exe";
    else if (process.platform === 'linux') assetPattern = ".appimage";
    else if (process.platform === 'darwin') assetPattern = ".dmg";
    const asset = release.assets.find(a => a.name.toLowerCase().endsWith(assetPattern));
    if (!asset) { showToast("No compatible update found for your OS."); setProcessingState(false); return; }
    try {
        const homeDir = require('os').homedir(); const downloadPath = path.join(homeDir, 'Downloads', asset.name);
        updateProgress(10, `Downloading Launcher Update...`); await downloadFile(asset.browser_download_url, downloadPath);
        updateProgress(100, "Download Complete. Launching Installer...");
        await new Promise(r => setTimeout(r, 1000));
        if (process.platform === 'win32') childProcess.exec(`start "" "${downloadPath}"`);
        else if (process.platform === 'linux') { fs.chmodSync(downloadPath, 0o755); childProcess.exec(`"${downloadPath}"`); }
        else if (process.platform === 'darwin') childProcess.exec(`open "${downloadPath}"`);
        setTimeout(() => ipcRenderer.send('window-close'), 2000);
    } catch (e) { showToast("Launcher Update Error: " + e.message); setProcessingState(false); }
}

async function loadSplashText() {
    const splashEl = document.getElementById('splash-text');
    if (!splashEl) return;
    try {
        const filePath = path.join(__dirname, 'strings.txt');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').map(l => l.trim()).filter(l => l !== '');
            if (lines.length > 0) {
                const randomSplash = lines[Math.floor(Math.random() * lines.length)];
                splashEl.textContent = randomSplash;
            }
        }
    } catch (e) {
        console.error("Failed to load splash text:", e);
        splashEl.textContent = "Welcome!";
    }
    // Also sync classic splash text
    const classicSplash = document.getElementById('classic-splash-text');
    if (classicSplash && splashEl) classicSplash.textContent = splashEl.textContent;
}

// ============================================================
// CLASSIC LAUNCHER THEME FUNCTIONS
// ============================================================

async function loadTheme() {
    const isClassic = await Store.get('legacy_classic_theme', false);
    const cb = document.getElementById('classic-theme-checkbox');
    if (cb) cb.checked = isClassic;
    applyTheme(isClassic);
}

async function loadSteamDeckMode() {
    const autoSteamDeck = isSteamDeckEnvironment();
    const saved = await Store.get('legacy_steamdeck_mode', null);
    const enabled = saved === null ? autoSteamDeck : saved;
    const cb = document.getElementById('steamdeck-mode-checkbox');
    if (cb) cb.checked = enabled;
    applySteamDeckMode(enabled);
}

async function loadControllerLayoutMode() {
    const mode = await Store.get('legacy_controller_layout_mode', 'auto');
    GamepadManager.setControlLayoutMode(mode);
    const select = document.getElementById('controller-layout-select');
    if (select) {
        select.value = mode;
        applyControllerLayoutPresetState(mode);
    }
}

function applySteamDeckMode(enabled) {
    document.body.classList.toggle('steamdeck-mode', !!enabled);
}

function applyTheme(isClassic) {
    document.body.classList.toggle('classic-theme', isClassic);
    if (isClassic) {
        syncClassicVersionSelect();
        updateClassicUsername();
    }
}

async function updateClassicUsername() {
    const username = await Store.get('legacy_username', "Player");
    const display = document.getElementById('classic-username-display');
    const avatar = document.getElementById('classic-avatar');
    if (display) display.textContent = username || "Player";
    if (avatar) avatar.textContent = (username || "P")[0].toUpperCase();
}

function syncClassicVersionSelect() {
    const mainSelect = document.getElementById('version-select');
    const classicSelect = document.getElementById('classic-version-select');
    const classicDisplay = document.getElementById('classic-version-display');
    if (!mainSelect || !classicSelect) return;
    // Copy options from main to classic
    classicSelect.innerHTML = mainSelect.innerHTML;
    classicSelect.selectedIndex = mainSelect.selectedIndex;
    if (classicDisplay && classicSelect.selectedIndex >= 0) {
        classicDisplay.textContent = classicSelect.options[classicSelect.selectedIndex]?.text || "Loading...";
    }
}

function syncVersionFromClassic() {
    const classicSelect = document.getElementById('classic-version-select');
    const classicDisplay = document.getElementById('classic-version-display');
    const mainSelect = document.getElementById('version-select');
    if (!classicSelect || !mainSelect) return;
    mainSelect.selectedIndex = classicSelect.selectedIndex;
    if (classicDisplay && classicSelect.selectedIndex >= 0) {
        classicDisplay.textContent = classicSelect.options[classicSelect.selectedIndex]?.text || "";
    }
    updateSelectedRelease();
}

async function toggleSnapshots(show, id = null) {
    const modal = document.getElementById('snapshots-modal');
    if (show) {
        snapshotInstanceId = id || currentInstanceId;
        const inst = instances.find(i => i.id === snapshotInstanceId);
        document.getElementById('snapshot-instance-name').textContent = inst ? inst.name : "";
        await renderSnapshotsList();
        document.activeElement?.blur();
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        UiSoundManager.play('popupOpen');
    } else {
        modal.style.opacity = '0';
        UiSoundManager.play('popupClose');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

async function renderSnapshotsList() {
    const container = document.getElementById('snapshots-list-container');
    container.innerHTML = '';
    const inst = instances.find(i => i.id === snapshotInstanceId);
    if (!inst || !inst.snapshots || inst.snapshots.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">No snapshots found.</div>';
        return;
    }

    inst.snapshots.sort((a,b) => b.timestamp - a.timestamp).forEach((snap) => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center p-3 border-b border-[#333] hover:bg-[#111]';
        const date = new Date(snap.timestamp).toLocaleString();
        item.innerHTML = `
            <div class="flex flex-col">
                <span class="text-white text-lg font-bold">${snap.tag || 'Unknown Version'}</span>
                <span class="text-gray-400 text-sm">${date}</span>
            </div>
            <div class="flex gap-2">
                <div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="rollbackToSnapshot('${snap.id}')">ROLLBACK</div>
                <div class="btn-mc !w-[100px] !h-[40px] !text-lg !mb-0" onclick="deleteSnapshot('${snap.id}')">DELETE</div>
            </div>
        `;
        container.appendChild(item);
    });
}

function openSnapshotsManager(id) {
    toggleSnapshots(true, id);
}

async function createSnapshotManual() {
    const inst = instances.find(i => i.id === snapshotInstanceId);
    if (!inst) return;
    setProcessingState(true);
    updateProgress(0, "Creating Snapshot...");
    try {
        await createSnapshot(inst);
        showToast("Snapshot Created!");
        await renderSnapshotsList();
    } catch (e) {
        showToast("Failed to create snapshot: " + e.message);
    }
    setProcessingState(false);
}

async function createSnapshot(inst) {
    if (!fs.existsSync(inst.installPath)) return;
    
    const snapshotId = 'snap-' + Date.now();
    const snapshotsDir = path.join(path.dirname(inst.installPath), 'Snapshots', inst.id);
    if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });
    
    const dest = path.join(snapshotsDir, snapshotId);
    
    // Copy entire folder. fs.cpSync is available in modern Node/Electron
    fs.cpSync(inst.installPath, dest, { recursive: true });
    
    if (!inst.snapshots) inst.snapshots = [];
    inst.snapshots.push({
        id: snapshotId,
        timestamp: Date.now(),
        tag: inst.installedTag || 'Manual Snapshot',
        path: dest
    });
    
    await saveInstancesToStore();
}

async function rollbackToSnapshot(snapId) {
    const inst = instances.find(i => i.id === snapshotInstanceId);
    if (!inst) return;
    const snap = inst.snapshots.find(s => s.id === snapId);
    if (!snap) return;

    if (!confirm(`Are you sure you want to ROLLBACK ${inst.name} to the snapshot from ${new Date(snap.timestamp).toLocaleString()}? This will overwrite your current files.`)) return;

    setProcessingState(true);
    updateProgress(10, "Preparing Rollback...");

    try {
        if (fs.existsSync(inst.installPath)) {
            // Move current to temp just in case
            const temp = inst.installPath + "_rollback_temp";
            if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
            fs.renameSync(inst.installPath, temp);
        }

        updateProgress(50, "Restoring Files...");
        fs.cpSync(snap.path, inst.installPath, { recursive: true });
        
        inst.installedTag = snap.tag;
        await saveInstancesToStore();
        
        // Cleanup temp
        const temp = inst.installPath + "_rollback_temp";
        if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });

        showToast("Rollback Successful!");
        if (snapshotInstanceId === currentInstanceId) {
            updatePlayButtonText();
            if (window.loadMainMenuSkin) window.loadMainMenuSkin();
        }
    } catch (e) {
        showToast("Rollback Failed: " + e.message);
        console.error(e);
    }
    setProcessingState(false);
}

async function deleteSnapshot(snapId) {
    const inst = instances.find(i => i.id === snapshotInstanceId);
    if (!inst) return;
    const snapIndex = inst.snapshots.findIndex(s => s.id === snapId);
    if (snapIndex === -1) return;
    
    if (!confirm("Delete this snapshot? (This will free up disk space)")) return;

    try {
        const snap = inst.snapshots[snapIndex];
        if (fs.existsSync(snap.path)) {
            fs.rmSync(snap.path, { recursive: true, force: true });
        }
        inst.snapshots.splice(snapIndex, 1);
        await saveInstancesToStore();
        renderSnapshotsList();
        showToast("Snapshot Deleted");
    } catch (e) {
        showToast("Error deleting snapshot: " + e.message);
    }
}

// Global functions for HTML onclick
window.toggleSidebar = toggleSidebar;
window.minimizeWindow = minimizeWindow;
window.toggleMaximize = toggleMaximize;
window.closeWindow = closeWindow;
window.launchGame = launchGame;
window.updateSelectedRelease = updateSelectedRelease;
window.toggleProfile = toggleProfile;
window.toggleServers = toggleServers;
window.addServer = addServer;
window.removeServer = removeServer;
window.toggleOptions = toggleOptions;
window.saveOptions = saveOptions;
window.saveProfile = saveProfile;
window.updateCompatDisplay = updateCompatDisplay;
window.checkForUpdatesManual = checkForUpdatesManual;
window.browseInstallDir = browseInstallDir;
window.openGameDir = openGameDir;
window.toggleMusic = toggleMusic;
window.applyRepoPreset = applyRepoPreset;
window.getInstallDir = getInstallDir;
window.showToast = showToast;
window.toggleInstances = toggleInstances;
window.createNewInstance = createNewInstance;
window.saveNewInstance = saveNewInstance;
window.switchInstance = switchInstance;
window.deleteInstance = deleteInstance;
window.toggleAddInstance = toggleAddInstance;
window.openSnapshotsManager = openSnapshotsManager;
window.rollbackToSnapshot = rollbackToSnapshot;
window.deleteSnapshot = deleteSnapshot;
window.createSnapshotManual = createSnapshotManual;
window.toggleSnapshots = toggleSnapshots;
window.syncVersionFromClassic = syncVersionFromClassic;
// Desktop shortcut for Linux AppImage
function ensureDesktopShortcut() {
  if (typeof process === 'undefined' || process.platform !== 'linux') return;
  try {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const home = os.homedir();
    const desktopDir = path.join(home, '.local', 'share', 'applications');
    const desktopPath = path.join(desktopDir, 'LegacyLauncher.desktop');
    if (fs.existsSync(desktopPath)) return;
    const appPath = process.env.APPIMAGE || process.argv[0];
    if (!appPath) return;
    const content = `[Desktop Entry]
Type=Application
Name=LegacyLauncher
Comment=LegacyLauncher AppImage
Exec="${appPath}" %U
Icon=LegacyLauncher
Terminal=false
Categories=Game;Emulation;`;
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(desktopPath, content);
  } catch (e) {
    console.error('Failed to create desktop shortcut:', e);
  }
}
// Ensure shortcut exists on startup
ensureDesktopShortcut();
