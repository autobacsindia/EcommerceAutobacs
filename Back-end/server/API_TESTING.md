# API Test Commands

## Testing with cURL

### 1. Health Check
```bash
curl http://localhost:5000/
```

### 2. Register a User
```bash
curl -X POST http://localhost:5000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 3. Login
```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

Save the token from the response for authenticated requests.

### 4. Get User Profile (Replace TOKEN)
```bash
curl http://localhost:5000/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 5. Get All Products
```bash
curl http://localhost:5000/products
```

### 6. Get All Categories
```bash
curl http://localhost:5000/categories
```

### 7. Get User Cart (Authenticated)
```bash
curl http://localhost:5000/cart \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 8. Get User Wishlist (Authenticated)
```bash
curl http://localhost:5000/wishlist \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Testing with PowerShell

### 1. Health Check
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/" -Method Get
```

### 2. Register User
```powershell
$body = @{
    name = "Test User"
    email = "test@example.com"
    password = "password123"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

### 3. Login and Save Token
```powershell
$body = @{
    email = "test@example.com"
    password = "password123"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:5000/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

$token = $response.token
Write-Host "Token: $token"
```

### 4. Get User Profile
```powershell
$headers = @{
    Authorization = "Bearer $token"
}

Invoke-RestMethod -Uri "http://localhost:5000/auth/me" `
  -Method Get `
  -Headers $headers
```

### 5. Get Products
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/products" -Method Get
```

## Testing Workflow

1. **Start the server:**
   ```bash
   cd "C:\Main project\Autobacs\Back-end\server"
   npm start
   ```

2. **Run health check** to verify server is running

3. **Register a test user**

4. **Login to get JWT token**

5. **Test authenticated endpoints** using the token

6. **Test public endpoints** (products, categories)

## Expected Results

- ✅ All requests should return JSON responses
- ✅ Health check returns API information
- ✅ Registration creates user and returns token
- ✅ Login returns token for existing user
- ✅ Protected routes require valid token
- ✅ Public routes accessible without token
- ✅ Invalid requests return appropriate error messages

## Error Testing

### Test Invalid Registration (Missing Fields)
```bash
curl -X POST http://localhost:5000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```
Expected: 400 error with validation message

### Test Invalid Login
```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "wrongpassword"
  }'
```
Expected: 401 error

### Test Protected Route Without Token
```bash
curl http://localhost:5000/cart
```
Expected: 401 error - no token provided

### Test Invalid Product ID
```bash
curl http://localhost:5000/products/invalidid123
```
Expected: 400 error - invalid ID format