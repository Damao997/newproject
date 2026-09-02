try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8001/pages/data-board.html' -UseBasicParsing -TimeoutSec 5; "Design 8001 OK: $($r.StatusCode)" } catch { "Design 8001 ERR: $($_.Exception.Message)" }
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/data/board/category' -UseBasicParsing -TimeoutSec 5; "React 5173 OK: $($r.StatusCode)" } catch { "React 5173 ERR: $($_.Exception.Message)" }
