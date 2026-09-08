$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$books = @()
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root 'ChecklistSource') -Filter '*.xlsx') {
  $zip = [IO.Compression.ZipFile]::OpenRead($file.FullName)
  try {
    function ReadEntry($name) {
      $reader = [IO.StreamReader]::new($zip.GetEntry($name).Open())
      try { $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    [xml]$stringsXml = ReadEntry 'xl/sharedStrings.xml'
    $strings = @($stringsXml.sst.si | ForEach-Object { $_.InnerText })
    [xml]$book = ReadEntry 'xl/workbook.xml'
    [xml]$rels = ReadEntry 'xl/_rels/workbook.xml.rels'
    $sheets = @()
    foreach ($s in $book.workbook.sheets.sheet) {
      $relId = $s.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      $rel = $rels.Relationships.Relationship | Where-Object Id -eq $relId
      $target = if ($rel.Target.StartsWith('/')) { $rel.Target.TrimStart('/') } else { 'xl/' + $rel.Target }
      [xml]$xml = ReadEntry $target
      $cells = [ordered]@{}
      foreach ($row in $xml.worksheet.sheetData.row) {
        foreach ($c in $row.c) {
          $v = [string]$c.v
          if ($c.t -eq 's') { $v = $strings[[int]$v] }
          if ($c.t -eq 'inlineStr') { $v = $c.is.InnerText }
          if ($v -ne '' -or $c.f) {
            $item = [ordered]@{ value = $v }
            if ($c.f) { $item.formula = if ($c.f -is [string]) { $c.f } else { $c.f.InnerText } }
            $cells[$c.r] = $item
          }
        }
      }
      $sheets += @{ name = $s.name; cells = $cells }
    }
    $books += @{ file = $file.Name; type = $(if ($file.Name -match 'Condominium') { 'condominium' } else { 'subdivision' }); sheets = $sheets }
  } finally { $zip.Dispose() }
}
$out = Join-Path $root 'source-extract.json'
[IO.File]::WriteAllText($out, (ConvertTo-Json -InputObject $books -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Output "Extracted $($books.Count) workbooks to $out"
