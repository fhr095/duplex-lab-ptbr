param(
  [Parameter(Mandatory = $true)]
  [string]$ListenAddress,
  [int]$ListenPort = 9223,
  [string]$TargetAddress = "127.0.0.1",
  [int]$TargetPort = 9223
)

$ErrorActionPreference = "Stop"
$listener = [System.Net.Sockets.TcpListener]::new(
  [System.Net.IPAddress]::Parse($ListenAddress),
  $ListenPort
)
$listener.Start()
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $target = [System.Net.Sockets.TcpClient]::new()
    try {
      $target.Connect($TargetAddress, $TargetPort)
      $clientStream = $client.GetStream()
      $targetStream = $target.GetStream()
      $toTarget = $clientStream.CopyToAsync($targetStream)
      $toClient = $targetStream.CopyToAsync($clientStream)
      [System.Threading.Tasks.Task]::WaitAny(
        [System.Threading.Tasks.Task[]]@($toTarget, $toClient)
      ) | Out-Null
    } finally {
      $target.Dispose()
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
