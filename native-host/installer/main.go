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
	silent := len(os.Args) > 1 && os.Args[len(os.Args)-1] == "--silent"
	// 按参数选择安装或卸载。
	if len(os.Args) > 1 && os.Args[1] == "--uninstall" {
		uninstall(silent)
		return
	}

	fmt.Println("============================================")
	fmt.Println("  Network Analyzer - Install")
	fmt.Println("============================================")
	fmt.Println()

	installDir := getInstallDir()
	fmt.Printf("Install to: %s\n\n", installDir)

	if err := os.MkdirAll(installDir, 0755); err != nil {
		fail("Failed to create directory: " + err.Error())
	}

	exePath := filepath.Join(installDir, "network_analyzer.exe")
	if err := os.WriteFile(exePath, binaryData, 0755); err != nil {
		fail("Failed to write binary: " + err.Error())
	}
	fmt.Println("[OK] Installed network_analyzer.exe")

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

	if err := regAdd("Software\\Google\\Chrome\\NativeMessagingHosts\\"+hostName, manifestPath); err != nil {
		fail("Failed to register Chrome: " + err.Error())
	}
	fmt.Println("[OK] Registered to Chrome")

	if err := regAdd("Software\\Microsoft\\Edge\\NativeMessagingHosts\\"+hostName, manifestPath); err != nil {
		fail("Failed to register Edge: " + err.Error())
	}
	fmt.Println("[OK] Registered to Edge")

	// 将安装器复制为卸载程序。
	selfPath, _ := os.Executable()
	uninstallerPath := filepath.Join(installDir, "uninstall.exe")
	if selfPath != "" && selfPath != uninstallerPath {
		selfData, err := os.ReadFile(selfPath)
		if err != nil {
			fail("Failed to read installer: " + err.Error())
		}
		if err := os.WriteFile(uninstallerPath, selfData, 0755); err != nil {
			fail("Failed to create uninstaller: " + err.Error())
		}
	}

	fmt.Println()
	fmt.Println("============================================")
	fmt.Println("  Install complete! Please restart browser.")
	fmt.Printf("  Uninstall: %s --uninstall\n", uninstallerPath)
	fmt.Println("============================================")
	fmt.Println()
	if !silent {
		fmt.Print("Press Enter to exit...")
		fmt.Scanln()
	}
}

func uninstall(silent bool) {
	fmt.Println("============================================")
	fmt.Println("  Network Analyzer - Uninstall")
	fmt.Println("============================================")
	fmt.Println()

	installDir := getInstallDir()

	if err := regDelete("Software\\Google\\Chrome\\NativeMessagingHosts\\" + hostName); err != nil {
		fail("Failed to remove Chrome registration: " + err.Error())
	}
	fmt.Println("[OK] Removed Chrome registration")

	if err := regDelete("Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + hostName); err != nil {
		fail("Failed to remove Edge registration: " + err.Error())
	}
	fmt.Println("[OK] Removed Edge registration")

	os.Remove(filepath.Join(installDir, "network_analyzer.exe"))
	os.Remove(filepath.Join(installDir, hostName+".json"))
	fmt.Println("[OK] Deleted program files")

	fmt.Println()
	fmt.Println("============================================")
	fmt.Println("  Uninstall complete! Please restart browser.")
	fmt.Println("============================================")
	fmt.Println()
	if !silent {
		fmt.Print("Press Enter to exit...")
		fmt.Scanln()
	}

	selfPath, _ := os.Executable()
	if selfPath != "" {
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

func regAdd(key, value string) error {
	return exec.Command("reg", "add", "HKCU\\"+key, "/ve", "/t", "REG_SZ", "/d", value, "/f").Run()
}

func regDelete(key string) error {
	return exec.Command("reg", "delete", "HKCU\\"+key, "/f").Run()
}

func fail(msg string) {
	fmt.Printf("[ERROR] %s\n", msg)
	if len(os.Args) < 2 || os.Args[len(os.Args)-1] != "--silent" {
		fmt.Print("Press Enter to exit...")
		fmt.Scanln()
	}
	os.Exit(1)
}
