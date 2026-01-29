# Autobacs Web App Deployment Guide

## 🚀 Overview

This guide provides step-by-step instructions for deploying the Autobacs e-commerce application to production. The application consists of:

- **Frontend**: Next.js 16+ application (port 3000)
- **Backend**: Node.js/Express API server (port 5000)
- **Database**: MongoDB (local or Atlas)
- **Payment**: Razorpay integration
- **Maps**: Google Maps API integration

## 📋 Prerequisites

Before deployment, ensure you have:

1. **Production Environment Access**
   - Server/VPS with Node.js 18+ installed
   - Domain name and SSL certificate
   - MongoDB database (local or Atlas)

2. **API Keys & Credentials**
   - MongoDB Atlas credentials (if using cloud database)
   - Razorpay production keys
   - Google Maps API keys
   - SendGrid API key (for emails)
   - Twilio credentials (for SMS, optional)

3. **Development Tools**
   - Git for version control
   - SSH access to production server
   - PM2 or similar process manager

## 🏗️ Architecture Overview

```
Internet → Load Balancer/Reverse Proxy (Nginx) → 
    ├── Frontend (Next.js Static Assets + Server)
    └── Backend (Node.js API Server)
         └── Database (MongoDB)
```

## 🛠️ Deployment Options

### Option 1: Traditional VPS Deployment (Recommended for Control)

**Providers**: DigitalOcean, AWS EC2, Linode, Vultr

**Estimated Cost**: $10-40/month

### Option 2: Platform-as-a-Service

**Frontend**: Vercel, Netlify
**Backend**: Railway, Render, Heroku
**Database**: MongoDB Atlas

**Estimated Cost**: $20-100/month (depending on usage)

### Option 3: Cloud Provider Full Stack

**AWS**: EC2 + RDS + S3 + CloudFront
**Google Cloud**: Compute Engine + Cloud SQL + Cloud Storage
**Azure**: Virtual Machines + Cosmos DB + Storage

**Estimated Cost**: $50-200/month

## 🔧 Step-by-Step Deployment

### Phase 1: Environment Preparation

#### 1.1 Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 process manager
sudo npm install -g pm2

# Install Nginx
sudo apt install nginx -y

# Install MongoDB (if using local database)
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org
```

#### 1.2 Domain and SSL Setup

```bash
# Install Certbot for SSL certificates
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### Phase 2: Application Deployment

#### 2.1 Backend Deployment

1. **Clone repository to server**
```bash
cd /var/www
git clone <your-repo-url> autobacs
cd autobacs/Autobacs/Back-end/server
```

2. **Create production environment file**
```bash
cp .env .env.production
```

3. **Update production environment variables**
```env
# .env.production
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://yourdomain.com

# MongoDB Configuration (Production)
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/autobacs

# JWT Configuration (Change this!)
JWT_SECRET=your_production_secret_key_here_change_this

# Production API Keys
RAZORPAY_KEY_ID=your_production_razorpay_key_id
RAZORPAY_KEY_SECRET=your_production_razorpay_key_secret

# Google Maps (Production)
GOOGLE_MAPS_CLIENT_KEY=your_production_google_maps_client_key
GOOGLE_MAPS_SERVER_KEY=your_production_google_maps_server_key

# Email Configuration
SENDGRID_API_KEY=your_production_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

4. **Install dependencies and build**
```bash
npm install --production
npm run build  # if you have build scripts
```

5. **Start with PM2**
```bash
pm2 start server.js --name "autobacs-backend" --env production
pm2 startup
pm2 save
```

#### 2.2 Frontend Deployment

1. **Navigate to frontend directory**
```bash
cd /var/www/autobacs/Autobacs/Front-end/web
```

2. **Create production environment file**
```bash
cp .env.local .env.production.local
```

3. **Update production environment variables**
```env
# .env.production.local
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_RAZORPAY_KEY_ID=your_production_razorpay_key_id
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_production_google_maps_key
```

4. **Build for production**
```bash
npm install --production
npm run build
```

5. **Start with PM2**
```bash
pm2 start npm --name "autobacs-frontend" -- start
pm2 save
```

### Phase 3: Nginx Configuration

Create Nginx configuration files:

#### 3.1 Main Site Configuration
```nginx
# /etc/nginx/sites-available/autobacs
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
    }
    
    # API Routes
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Static Assets Optimization
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

#### 3.2 Enable Configuration
```bash
sudo ln -s /etc/nginx/sites-available/autobacs /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Phase 4: Database Migration

#### 4.1 MongoDB Atlas (Recommended)
If using MongoDB Atlas:

1. **Update IP whitelist**
```bash
# Add your production server IP to MongoDB Atlas whitelist
# This can be done via MongoDB Atlas dashboard or using the CLI tool
```

2. **Migrate data from development**
```bash
# Export from local development
mongodump --db autobacs --out ./backup

# Import to production (Atlas)
mongorestore --uri="mongodb+srv://username:password@cluster.mongodb.net/autobacs" ./backup/autobacs
```

#### 4.2 Local MongoDB
If using local MongoDB:

```bash
# Enable MongoDB service
sudo systemctl enable mongod
sudo systemctl start mongod

# Secure MongoDB
sudo mongo
> use admin
> db.createUser({
    user: "admin",
    pwd: "your_secure_password",
    roles: [{role: "root", db: "admin"}]
  })
> exit

# Update MongoDB configuration
sudo nano /etc/mongod.conf
# Add:
# security:
#   authorization: enabled
```

### Phase 5: Monitoring and Maintenance

#### 5.1 Set up Monitoring

```bash
# Install monitoring tools
sudo npm install -g pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7

# Set up health checks
# Create health check endpoint in your backend
```

#### 5.2 Automated Backups

```bash
# Create backup script
cat > /home/ubuntu/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/ubuntu/backups"
MONGO_URI="mongodb+srv://username:password@cluster.mongodb.net/autobacs"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup MongoDB
mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR/mongodb_$DATE"

# Compress backup
tar -czf "$BACKUP_DIR/backup_$DATE.tar.gz" -C "$BACKUP_DIR" "mongodb_$DATE"

# Remove uncompressed files
rm -rf "$BACKUP_DIR/mongodb_$DATE"

# Keep only last 7 days of backups
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +7 -delete
EOF

chmod +x /home/ubuntu/backup.sh

# Add to crontab for daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /home/ubuntu/backup.sh") | crontab -
```

## 🔐 Security Hardening

### 1. Firewall Configuration
```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw allow 5000  # Only for internal access
```

### 2. Application Security
- Change default JWT secret
- Use strong passwords for all services
- Regular security updates
- Implement rate limiting
- Set up proper CORS policies

### 3. File Permissions
```bash
sudo chown -R www-data:www-data /var/www/autobacs
sudo chmod -R 755 /var/www/autobacs
```

## 🚨 Troubleshooting Common Issues

### Application Won't Start
```bash
# Check PM2 logs
pm2 logs autobacs-backend
pm2 logs autobacs-frontend

# Check system resources
df -h  # Disk space
free -h  # Memory
top  # CPU usage
```

### Database Connection Issues
```bash
# Test MongoDB connection
mongosh "mongodb+srv://username:password@cluster.mongodb.net/autobacs"

# Check firewall rules
sudo ufw status
```

### Nginx Configuration Issues
```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

## 📊 Performance Optimization

### 1. Enable Gzip Compression
Add to Nginx configuration:
```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_proxied any;
gzip_comp_level 6;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/json
    application/javascript
    application/xml+rss
    application/atom+xml
    image/svg+xml;
```

### 2. Enable Caching
```nginx
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. PM2 Cluster Mode
For better performance:
```bash
pm2 start npm --name "autobacs-frontend" -- start -i max
```

## 🔄 Deployment Automation

Create a deployment script for future updates:

```bash
#!/bin/bash
# deploy.sh

echo "Starting deployment..."

# Pull latest code
cd /var/www/autobacs
git pull origin main

# Backend deployment
cd Autobacs/Back-end/server
npm install --production
pm2 reload autobacs-backend

# Frontend deployment
cd ../../Front-end/web
npm install --production
npm run build
pm2 reload autobacs-frontend

# Check status
pm2 status

echo "Deployment completed!"
```

## 📈 Scaling Considerations

### Horizontal Scaling
- Use load balancer for multiple frontend instances
- Database read replicas for MongoDB
- Redis for session storage and caching

### Vertical Scaling
- Upgrade server resources (CPU, RAM, Storage)
- Optimize database queries
- Implement CDN for static assets

## 💰 Cost Estimation

### Basic Setup (VPS)
- Server: $10-20/month (2GB RAM, 1 CPU)
- Domain: $10-15/year
- SSL Certificate: Free (Let's Encrypt)
- **Total**: ~$15/month

### Medium Setup (Managed Services)
- VPS: $20/month
- MongoDB Atlas: $9-25/month
- CDN (optional): $10-50/month
- **Total**: $39-95/month

### Enterprise Setup (Cloud)
- Multiple instances: $100-300/month
- Premium database: $50-200/month
- Advanced monitoring: $20-50/month
- **Total**: $170-550/month

## 🎯 Post-Deployment Checklist

- [ ] Application accessible via domain
- [ ] SSL certificate working (HTTPS)
- [ ] All API endpoints responding
- [ ] Database connection established
- [ ] Payment gateway functioning
- [ ] Email notifications working
- [ ] Performance metrics acceptable
- [ ] Monitoring alerts configured
- [ ] Backup system operational
- [ ] Security measures implemented

## 🆘 Support and Maintenance

### Regular Maintenance Tasks
- Weekly: Check application logs
- Monthly: Update dependencies and OS
- Quarterly: Security audit and penetration testing
- Annually: Review and optimize costs

### Emergency Procedures
- Rollback to previous version using Git
- Restore database from backups
- Scale resources during traffic spikes
- Contact support for critical issues

---

**Last Updated**: January 2026
**Version**: 1.0.0
**Author**: Autobacs Development Team