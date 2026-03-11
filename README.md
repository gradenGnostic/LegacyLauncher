<div align="center">

# LegacyLauncher

A custom launcher for Minecraft Legacy Console Edition.

<table>
  <tr>
    <td align="center">
      <img width="1920" src="https://github.com/user-attachments/assets/aa0466a2-11f7-400f-a061-f64938a08305" alt="LegacyLauncher Interface" />
      <br />
      <em>The interface of Legacy Launcher v3.0.1</em>
    </td>
  </tr>
</table>

## Features

<table align="center">
  <tr>
    <td align="center" width="300">
      🔄 <b>Automatic Updates</b><br />
      <p align="center">Fetches and installs the latest releases directly from GitHub repositories.</p>
    </td>
    <td align="center" width="300">
      💻 <b>Multi-Platform Support</b><br />
      <p align="center">Compatible with Windows 10 64-bit+, Linux, and macOS Big Sur+.</p>
    </td>
  </tr>
  <tr>
    <td align="center" width="300">
      👤 <b>Profile Management</b><br />
      <p align="center">Persistent storage for usernames and automated playtime tracking.</p>
    </td>
    <td align="center" width="300">
      ⚙️ <b>Advanced Launch</b><br />
      <p align="center">Control over connection parameters, IPs, ports, and headless server mode.</p>
    </td>
  </tr>
</table>

<br />

---

## Getting Started

<table>
  <tr>
    <td align="center" width="400">
      🚀 <b>Standard Download</b><br />
      <p align="center">
        Visit the <a href="https://github.com/gradenGnostic/LegacyLauncher/releases/latest">Latest Releases</a> page and download the appropriate package for your system:
      </p>
      <ul style="display: inline-block; text-align: left;">
        <li><b>Windows 10 64-bit+:</b> <code>LegacyLauncher.Setup.(version).exe</code></li>
        <li><b>Linux:</b> <code>LegacyLauncher-(version).AppImage</code></li>
        <li><b>macOS Big Sur+:</b> <code>LegacyLauncher-(version)-arm64.dmg</code></li>
      </ul>
    </td>
    <td align="center" width="400">
      🛠️ <b>Development & Contribution</b><br />
      <p align="center">
        To build from source or contribute to the project, ensure you have <a href="https://nodejs.org/">Node.js</a> installed and follow these steps:
      </p>
      <ol style="display: inline-block; text-align: left;">
        <li>Clone the repository</li>
        <li>Run <code>npm install</code></li>
        <li>Run <code>npm start</code> to test</li>
      </ol>
    </td>
  </tr>
</table>

### Compiling Executables

If you wish to package the launcher yourself, use the following commands based on your target platform:

| Platform | Command | Output Format |
| :---: | :---: | :---: |
| **Windows 10 64-bit+** | `npm run dist:win` | `.exe` Setup |
| **Linux** | `npm run dist` | `.AppImage` Binary |
| **macOS Big Sur+** | `npm run dist:mac` | `.dmg` Disk Image |

<br />

---

## Launcher Options

<p>Customize your experience via the <b>Options</b> menu within the launcher.</p>

| Setting | Description |
| :--- | :--- |
| **Installation Directory** | The local path where game files are stored |
| **GitHub Repository Source** | The repository used to fetch game updates |
| **Client Executable Name** | The specific filename the launcher attempts to execute |
| **Launcher Music Volume** | Adjust the background audio level of the launcher |
| **Connect/Bind IP** | Specify a custom IP address for network connections |
| **Port** | Define the network port for multiplayer sessions |
| **Launch as Headless Server (-server)** | Launch the client without a GUI for server hosting |
| **Use Classic Minecraft Launcher UI** | Replaces the modern GUI with a layout inspired by the 2013 launcher |

<br />

---

## System Requirements

<table>
  <tr>
    <td align="center" width="260">
      <b>Windows</b><br />
      Windows 10 64-bit or Windows 11
    </td>
    <td align="center" width="260">
      <b>Linux</b><br />
      <code>Wine</code> is required to run Windows binaries
    </td>
    <td align="center" width="260">
      <b>macOS</b><br />
      macOS Big Sur or newer (Apple Silicon)
    </td>
  </tr>
</table>

### Linux Setup
The `.AppImage` is designed to work across all distributions. To run Windows binaries, you must install the **Wine** compatibility layer using your package manager:

| Distribution | Command |
| :--- | :--- |
| **Ubuntu / Debian / Mint** | `sudo apt install wine` |
| **Fedora** | `sudo dnf install wine` |
| **Arch / Manjaro** | `sudo pacman -S wine` |
| **openSUSE** | `sudo zypper install wine` |

<br />

---

## Technical Stack

**Built With:**
`Electron` • `Node.js` • `Tailwind CSS` • `Discord RPC`

**Development Components:**
`HTML5` • `CSS3` • `JavaScript` • `Electron Builder`

<br />

---

## Troubleshooting

<table>
  <tr>
    <td align="left" width="400">
      <b>Common Solutions:</b>
      <ul>
        <li><b>Repository Error:</b> Verify the name in Options</li>
        <li><b>Executable Error:</b> Check if filename matches download</li>
        <li><b>Launch Failure:</b> Verify Wine is installed on your system</li>
        <li><b>Discord Error:</b> Ensure Discord is open with RPC enabled</li>
      </ul>
    </td>
    <td align="left" width="400">
      <b>Linux Specifics:</b>
      <ul>
        <li><b>Wine Check:</b> Run <code>wine --version</code> to verify install</li>
        <li><b>AppImage Permissions:</b> <code>chmod +x LegacyLauncher-*.AppImage</code></li>
      </ul>
    </td>
  </tr>
</table>

<br />

## Contributing

Feel free to submit **Issues** and **Pull Requests** to help improve the launcher!

<br />

## Star History

<a href="https://www.star-history.com/?repos=gradenGnostic%2FLegacyLauncher&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=gradenGnostic/LegacyLauncher&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=gradenGnostic/LegacyLauncher&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=gradenGnostic/LegacyLauncher&type=date&legend=top-left" />
 </picture>
</a>

</div>
