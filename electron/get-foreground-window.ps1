Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Foreground {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@

try {
    $hwnd = [Win32Foreground]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
        @{ 
            ProcessName = "Unknown"; 
            WindowTitle = ""; 
            ProcessId = 0; 
            IsBrowser = $false; 
            IsIncognito = $false; 
            Category = "Unknown" 
        } | ConvertTo-Json -Compress
        exit 0
    }

    $sb = New-Object System.Text.StringBuilder 512
    [void][Win32Foreground]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $windowTitle = $sb.ToString()

    $targetPid = 0
    [void][Win32Foreground]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)

    $process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    $processName = if ($process) { $process.ProcessName } else { "Unknown" }

    $isBrowser = $processName -match '^(chrome|msedge|brave|firefox|opera|vivaldi|arc)$'
    $isIncognito = $false
    $incognitoEvidence = ""

    if ($isBrowser) {
        # Check Window Title for Incognito/Private Indicators
        if ($windowTitle -match '(?i)(incognito|inprivate|private browsing|private window)') {
            $isIncognito = $true
            $incognitoEvidence = "Window title contains private browsing marker: $windowTitle"
        } else {
            # Secondary check: Inspect process command-line if accessible
            try {
                $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction SilentlyContinue
                if ($procInfo -and $procInfo.CommandLine -match '(?i)(--incognito|-incognito|--inprivate|-inprivate|-private)') {
                    $isIncognito = $true
                    $incognitoEvidence = "Process command line includes incognito switch: $($procInfo.CommandLine)"
                }
            } catch {
                # Ignore CIM permission or timeout errors
            }
        }
    }

    $category = "Application"
    if ($isBrowser) {
        if ($isIncognito) {
            $category = "External Browser (Incognito / InPrivate)"
        } else {
            $category = "External Web Browser"
        }
    } elseif ($processName -match '(?i)(slack|discord|teams|zoom|skype|whatsapp|telegram)') {
        $category = "Communication / Messaging App"
    } elseif ($processName -match '(?i)(notepad|wordpad|winword|excel|onenote)') {
        $category = "Notes / Document App"
    } elseif ($processName -match '(?i)(cmd|powershell|wt|terminal|bash)') {
        $category = "Command Terminal"
    } elseif ($processName -match '(?i)(chatgpt|claude|copilot)') {
        $category = "Desktop AI Application"
    }

    @{
        ProcessName = $processName
        WindowTitle = $windowTitle
        ProcessId = $targetPid
        IsBrowser = [bool]$isBrowser
        IsIncognito = [bool]$isIncognito
        IncognitoEvidence = $incognitoEvidence
        Category = $category
    } | ConvertTo-Json -Compress
} catch {
    @{ 
        ProcessName = "Unknown"
        WindowTitle = ""
        ProcessId = 0
        IsBrowser = $false
        IsIncognito = $false
        Category = "Unknown"
        Error = $_.Message 
    } | ConvertTo-Json -Compress
}
