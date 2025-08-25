 = @(8030,8000,8001,8020,8025,8002,8003,8010)
foreach( in ){  = Test-NetConnection -ComputerName 127.0.0.1 -Port  -WarningAction SilentlyContinue; Write-Output ( Port =>  + (.TcpTestSucceeded ? 'OPEN' : 'CLOSED')) }
