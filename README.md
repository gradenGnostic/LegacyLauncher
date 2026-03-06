# LegacyLauncher

A custom launcher for Minecraft Legacy Console Edition.

## Features

- **Minecraft-style GUI**: Authentic pixelated interface with Minecraft font and styling
- **Automatic Updates**: Fetches latest releases from GitHub repositories
- **Cross-platform Support**: Works on Windows and Linux
- **Profiles**: Save your username and track playtime
- **Custom Launch Options**: Configure IP, port, and server mode

## Installation

### From Source
1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the launcher:
   ```bash
   npm start
   ```


## Building

### Linux AppImage
```bash
npm run dist
```

### Windows Installer
```bash
npm run dist:win
```

## Configuration

### Repository Source
By default, the launcher fetches releases from `smartcmd/MinecraftConsoles`. You can change this in the Options menu.

### Launch Options
- **GitHub Repository**: Source repository for game releases
- **Client Executable**: Name of the executable file (default: `Minecraft.Client.exe`)
- **Compatibility Layer**: For Linux users - choose between direct execution, Wine, or Proton
- **Connect/Bind IP**: Optional IP address for multiplayer
- **Port**: Optional port number
- **Server Mode**: Launch as headless server

### Profile Settings
- **Username**: Your in-game player name
- **Playtime Tracking**: Automatically tracks total playtime

## System Requirements

- **Windows**: Direct execution of Windows executables
- **Linux**: Wine or Proton for running Windows executables
- **Internet**: Required for downloading game updates

## Compatibility Layers (Linux)

The launcher supports several compatibility options for Linux:

- **Direct**: Run native Linux executables (if available)
- **Wine**: Wine compatibility layer
- **Proton**: Steam's Proton compatibility layer

## Dependencies

- **Electron**: Cross-platform desktop app framework
- **discord-rpc**: Discord Rich Presence integration
- **extract-zip**: ZIP archive extraction
- **Tailwind CSS**: UI styling (via CDN)

## Development

The launcher is built with:
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Electron with Node.js
- **Styling**: Custom CSS with Minecraft theme + Tailwind CSS
- **Build**: Electron Builder

## Troubleshooting

### Common Issues

1. **Repository not found**: Check the repository name in Options
2. **Executable not found**: Verify the executable name matches the downloaded file
3. **Launch failures**: Try different compatibility layers on Linux
4. **Discord RPC issues**: Ensure Discord is running and RPC is enabled

### Linux Specific
- Install Wine: `sudo apt install wine` (Ubuntu/Debian)
- For Proton: Requires Steam installation
- AppImage permissions: `chmod +x LegacyLauncher-*.AppImage`

## Contributing

Feel free to submit issues and pull requests for improvements.</content>
