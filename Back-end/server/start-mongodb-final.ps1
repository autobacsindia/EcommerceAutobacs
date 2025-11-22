# Final script to start MongoDB without authentication
Write-Host "Starting MongoDB without authentication..."

# Kill any existing MongoDB processes
Write-Host "Killing any existing MongoDB processes..."
Stop-Process -Name mongod -Force -ErrorAction SilentlyContinue

# Wait a moment
Start-Sleep -Seconds 2

# Clear the lock file if it exists
Remove-Item -Path "C:\Main project\Autobacs\Back-end\server\mongodb-data\mongod.lock" -Force -ErrorAction SilentlyContinue

# Start MongoDB without authentication
Write-Host "Starting MongoDB..."
Start-Process -FilePath "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" -ArgumentList "--dbpath", "`"C:\Main project\Autobacs\Back-end\server\mongodb-data`"", "--port", "27017" -WindowStyle Normal

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