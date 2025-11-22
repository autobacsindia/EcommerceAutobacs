# Script to start MongoDB in background
Write-Host "Starting MongoDB in background..."

# Start MongoDB process
Start-Process -FilePath "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" -ArgumentList "--dbpath", "`"C:\Main project\Autobacs\Back-end\server\mongodb-data`"", "--port", "27017" -WindowStyle Normal

Write-Host "MongoDB started. Checking if it's running..."

# Wait a moment for MongoDB to start
Start-Sleep -Seconds 3

# Check if MongoDB is running
$process = Get-Process mongod -ErrorAction SilentlyContinue
if ($process) {
    Write-Host "MongoDB is running with PID: $($process.Id)"
} else {
    Write-Host "Failed to start MongoDB"
}