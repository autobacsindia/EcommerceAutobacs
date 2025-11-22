# Simple script to start MongoDB
Write-Host "Starting MongoDB..."
try {
    # Start MongoDB process and keep it running
    $process = Start-Process -FilePath "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" -ArgumentList "--dbpath", "`"C:\Main project\Autobacs\Back-end\server\mongodb-data`"", "--port", "27017" -PassThru -NoNewWindow -Wait
    
    Write-Host "MongoDB started with PID: $($process.Id)"
    Write-Host "Waiting for MongoDB to initialize..."
    
    # Wait a bit for MongoDB to start
    Start-Sleep -Seconds 5
    
    # Check if the process is still running
    if (!$process.HasExited) {
        Write-Host "MongoDB is running successfully!"
    } else {
        Write-Host "MongoDB process exited with code: $($process.ExitCode)"
    }
} catch {
    Write-Host "Error starting MongoDB: $($_.Exception.Message)"
}