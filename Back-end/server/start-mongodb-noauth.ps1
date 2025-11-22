# Script to start MongoDB without authentication
Write-Host "Starting MongoDB without authentication..."

# Kill any existing MongoDB processes
Stop-Process -Name mongod -Force -ErrorAction SilentlyContinue

# Wait a moment
Start-Sleep -Seconds 2

# Start MongoDB without authentication
Start-Process -FilePath "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" -ArgumentList "--dbpath", "`"C:\Main project\Autobacs\Back-end\server\mongodb-data`"", "--port", "27017" -WindowStyle Hidden

Write-Host "MongoDB started. Waiting for initialization..."

# Wait for MongoDB to start
Start-Sleep -Seconds 5

# Check if MongoDB is running
$process = Get-Process mongod -ErrorAction SilentlyContinue
if ($process) {
    Write-Host "MongoDB is running with PID: $($process.Id)"
    Write-Host "You can now test the connection with: node test-mongodb-connection.js"
} else {
    Write-Host "Failed to start MongoDB"
}