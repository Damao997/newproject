Add-Type -AssemblyName System.Drawing
$paths = @(
  'D:\flies\fy200-clone\web\audit\screenshots\react\data-import-mobile.png',
  'D:\flies\fy200-clone\web\audit\screenshots\design\data-import-mobile.png',
  'D:\flies\fy200-clone\web\audit\screenshots\react\data-import-desktop.png',
  'D:\flies\fy200-clone\web\audit\screenshots\design\data-import-desktop.png'
)
foreach ($p in $paths) {
  $img = [System.Drawing.Image]::FromFile($p)
  $bytes = (Get-Item $p).Length
  Write-Output ("{0} : {1}x{2} = {3} B ({4:N0} KB)" -f (Split-Path $p -Leaf), $img.Width, $img.Height, $bytes, ($bytes/1024))
  $img.Dispose()
}
