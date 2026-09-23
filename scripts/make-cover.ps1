# Resize a cover image to a fixed width and save it as a compressed JPEG.
# Uses Windows' own imaging codecs (WIC), so WebP, PNG and JPEG inputs all
# work with nothing installed.
param(
  [Parameter(Mandatory)] [string] $In,
  [Parameter(Mandatory)] [string] $Out,
  [int] $Width = 360,
  [int] $Quality = 82
)

Add-Type -AssemblyName PresentationCore

# DecodePixelWidth scales inside the decoder with WIC's high-quality filter,
# which is sharper than scaling the full-size bitmap afterwards.
$img = New-Object Windows.Media.Imaging.BitmapImage
$img.BeginInit()
$img.UriSource = New-Object Uri($In)
$img.DecodePixelWidth = $Width
$img.CacheOption = 'OnLoad'
$img.EndInit()

# JPEG has no alpha channel; convert explicitly rather than letting the
# encoder guess.
$rgb = New-Object Windows.Media.Imaging.FormatConvertedBitmap($img, [Windows.Media.PixelFormats]::Bgr24, $null, 0)

$enc = New-Object Windows.Media.Imaging.JpegBitmapEncoder
$enc.QualityLevel = $Quality
$enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($rgb))

$stream = [IO.File]::Create($Out)
try { $enc.Save($stream) } finally { $stream.Close() }

$size = (Get-Item $Out).Length
"{0}  {1}x{2}  {3:N1} KB" -f (Split-Path $Out -Leaf), $rgb.PixelWidth, $rgb.PixelHeight, ($size / 1KB)
