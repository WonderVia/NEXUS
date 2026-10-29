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
        @{ ProcessName = "Unknown"; WindowTitle = ""; ProcessId = 0 } | ConvertTo-Json -Compress
        exit 0
    }

    $sb = New-Object System.Text.StringBuilder 512
    [void][Win32Foreground]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $windowTitle = $sb.ToString()

    $targetPid = 0
    [void][Win32Foreground]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)

    $process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    $processName = if ($process) { $process.ProcessName } else { "Unknown" }

    @{
        ProcessName = $processName
        WindowTitle = $windowTitle
        ProcessId = $targetPid
    } | ConvertTo-Json -Compress
} catch {
    @{ ProcessName = "Unknown"; WindowTitle = ""; ProcessId = 0; Error = $_.Message } | ConvertTo-Json -Compress
}
