; Network Analyzer Native Host - Inno Setup Script
; 用于生成 Windows .exe 安装包
;
; 构建方式:
;   1. 安装 Inno Setup: https://jrsoftware.org/isdl.php
;   2. 命令行构建: iscc installer.iss
;   或者打开 Inno Setup Compiler GUI 加载此文件点击编译
;
; 前置条件: 先运行 ../../build.sh 编译出 dist/windows-amd64/network_analyzer.exe

#define MyAppName "Network Analyzer"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "Network Analyzer"
#define MyAppURL "https://github.com/isyntop/Network-Analyzer"
#define HostName "com.network.analyzer"
#define ExtensionID "kpfbbomehbepffmhnbjmooahcfedpndg"
#define StoreExtensionID "daenfnkblgiedkbkjnheiebnfhhmbbdo"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName} Native Host
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Network-Analyzer
DisableProgramGroupPage=yes
OutputDir=..\..\dist
OutputBaseFilename=Network-Analyzer-Host-Windows-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=lowest
SetupIconFile=..\..\..\..\icons\icon128.png
UninstallDisplayName={#MyAppName} Native Host
WizardStyle=modern

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\..\dist\windows-amd64\network_analyzer.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.bat"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Chrome Native Messaging Host registration
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
; Edge Native Messaging Host registration
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey

[Code]
procedure GenerateManifest();
var
  ManifestPath: String;
  ExePath: String;
  Lines: TStringList;
begin
  ManifestPath := ExpandConstant('{app}\{#HostName}.json');
  ExePath := ExpandConstant('{app}\network_analyzer.exe');
  // JSON requires forward slashes or escaped backslashes
  StringChangeEx(ExePath, '\', '\\', True);

  Lines := TStringList.Create;
  try
    Lines.Add('{');
    Lines.Add('  "name": "{#HostName}",');
    Lines.Add('  "description": "Network Analyzer Native Host",');
    Lines.Add('  "path": "' + ExePath + '",');
    Lines.Add('  "type": "stdio",');
    Lines.Add('  "allowed_origins": [');
    Lines.Add('    "chrome-extension://{#ExtensionID}/",');
    Lines.Add('    "chrome-extension://{#StoreExtensionID}/"');
    Lines.Add('  ]');
    Lines.Add('}');
    Lines.SaveToFile(ManifestPath);
  finally
    Lines.Free;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    GenerateManifest();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ManifestPath: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    ManifestPath := ExpandConstant('{app}\{#HostName}.json');
    if FileExists(ManifestPath) then
      DeleteFile(ManifestPath);
  end;
end;
