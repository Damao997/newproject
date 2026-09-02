$f = 'D:\flies\fy200-clone\web\audit\screenshots\react\analysis-category-budget-desktop.png'
$fi = Get-Item $f
Write-Output ('size_bytes=' + $fi.Length)
Write-Output ('size_kb=' + [math]::Round($fi.Length / 1KB, 2))
$img = [System.Drawing.Image]::FromFile($f)
Write-Output ('width=' + $img.Width)
Write-Output ('height=' + $img.Height)
$img.Dispose()
