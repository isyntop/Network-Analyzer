package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	_ "embed"
)

//go:embed payload/network_analyzer.exe
var binaryData []byte

const (
	hostName         = "com.network.analyzer"
	extensionID      = "kpfbbomehbepffmhnbjmooahcfedpndg"
	storeExtensionID = "daenfnkblgiedkbkjnheiebnfhhmbbdo"
)

func main() {
	// Check for uninstall flag
	if len(os.Args) > 1 && os.Args[1] == "--uninstall" {
		uninstall()
		return
	}

	fmt.Println("============================================")
	fmt.Println("  Network Analyzer - Install")
	fmt.Println("============================================")
	fmt.Println()

	installDir := getInstallDir()
	fmt.Printf("Install to: %s\n\n", installDir)

	// Create install directory
	if err := os.MkdirAll(installDir, 0755); err != nil {
		fail("Failed to create directory: " + err.Error())
	}

	// Write binary
	exePath := filepath.Join(installDir, "network_analyzer.exe")
	if err := os.WriteFile(exePath, binaryData, 0755); err != nil {
		fail("Failed to write binary: " + err.Error())
	}
	fmt.Println("[OK] Installed network_analyzer.exe")

	// Generate native messaging host manifest
	manifestPath := filepath.Join(installDir, hostName+".json")
	escapedPath := strings.ReplaceAll(exePath, `\`, `\\`)
	manifest := fmt.Sprintf(`{
  "name": "%s",
  "description": "Network Analyzer Native Host",
  "path": "%s",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://%s/",
    "chrome-extension://%s/"
  ]
}`, hostName, escapedPath, extensionID, storeExtensionID)

	if err := os.WriteFile(manifestPath, []byte(manifest), 0644); err != nil {
		fail("Failed to write manifest: " + err.Error())
	}
	fmt.Println("[OK] Created manifest")

	// Register to Chrome
	regAdd("Software\\Google\\Chrome\\NativeMessagingHosts\\"+hostName, manifestPath)
	fmt.Println("[OK] Registered to Chrome")

	// Register to Edge
	regAdd("Software\\Microsoft\\Edge\\NativeMessagingHosts\\"+hostName, manifestPath)
	fmt.Println("[OK] Registered to Edge")

	// Copy self as uninstaller
	selfPath, _ := os.Executable()
	uninstallerPath := filepath.Join(installDir, "uninstall.exe")
	if selfPath != "" && selfPath != uninstallerPath {
		selfData, err := os.ReadFile(selfPath)
		if err == nil {
			os.WriteFile(uninstallerPath, selfData, 0755)
		}
	}

	fmt.Println()
	fmt.Println("============================================")
	fmt.Println("  Install complete! Please restart browser.")
	fmt.Printf("  Uninstall: %s --uninstall\n", uninstallerPath)
	fmt.Println("============================================")
	fmt.Println()
	fmt.Print("Press Enter to exit...")
	fmt.Scanln()
}

func uninstall() {
	fmt.Println("============================================")
	fmt.Println("  Network Analyzer - Uninstall")
	fmt.Println("============================================")
	fmt.Println()

	installDir := getInstallDir()

	// Remove registry entries
	regDelete("Software\\Google\\Chrome\\NativeMessagingHosts\\" + hostName)
	fmt.Println("[OK] Removed Chrome registration")

	regDelete("Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + hostName)
	fmt.Println("[OK] Removed Edge registration")

	// Remove files
	os.Remove(filepath.Join(installDir, "network_analyzer.exe"))
	os.Remove(filepath.Join(installDir, hostName+".json"))
	fmt.Println("[OK] Deleted program files")

	fmt.Println()
	fmt.Println("============================================")
	fmt.Println("  Uninstall complete! Please restart browser.")
	fmt.Println("============================================")
	fmt.Println()
	fmt.Print("Press Enter to exit...")
	fmt.Scanln()

	// Try to remove self and directory (best effort)
	selfPath, _ := os.Executable()
	if selfPath != "" {
		// Use cmd /c to delete after process exits
		cmd := exec.Command("cmd", "/c", "ping", "127.0.0.1", "-n", "2", ">nul", "&",
			"del", "/f", selfPath, "&", "rmdir", installDir)
		cmd.Start()
	}
}

func getInstallDir() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		home, _ := os.UserHomeDir()
		localAppData = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(localAppData, "Network-Analyzer")
}

func regAdd(key, value string) {
	exec.Command("reg", "add", "HKCU\\"+key, "/ve", "/t", "REG_SZ", "/d", value, "/f").Run()
}

func regDelete(key string) {
	exec.Command("reg", "delete", "HKCU\\"+key, "/f").Run()
}

func fail(msg string) {
	fmt.Printf("[ERROR] %s\n", msg)
	fmt.Print("Press Enter to exit...")
	fmt.Scanln()
	os.Exit(1)
}
