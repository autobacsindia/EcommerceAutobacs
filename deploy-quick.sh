#!/bin/bash
# Autobacs Quick Deployment Script
# Usage: ./deploy-quick.sh

set -e  # Exit on any error

echo "🚀 Starting Autobacs Quick Deployment..."
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/var/www/autobacs"
BACKEND_DIR="$PROJECT_DIR/Autobacs/Back-end/server"
FRONTEND_DIR="$PROJECT_DIR/Autobacs/Front-end/web"
DOMAIN="yourdomain.com"  # Change this!

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Check prerequisites
print_status "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    echo "Please install Node.js 18+ first:"
    echo "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "sudo apt-get install -y nodejs"
    exit 1
fi

print_status "Node.js version: $(node --version)"

# Check if directories exist
if [ ! -d "$PROJECT_DIR" ]; then
    print_warning "Project directory not found. Creating..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $USER:$USER "$PROJECT_DIR"
fi

# Navigate to project directory
cd "$PROJECT_DIR"

# Clone repository (if not already present)
if [ ! -d ".git" ]; then
    print_status "Cloning repository..."
    git clone <your-repo-url> .
else
    print_status "Updating existing repository..."
    git pull origin main
fi

# Backend Setup
print_status "Setting up backend..."
cd "$BACKEND_DIR"

# Install backend dependencies
print_status "Installing backend dependencies..."
npm install --production

# Create production environment file if it doesn't exist
if [ ! -f ".env.production" ]; then
    print_warning "Creating .env.production file..."
    cp .env .env.production
    print_warning "Please update .env.production with your production values!"
    echo "Key values to update:"
    echo "  - MONGO_URI (MongoDB connection string)"
    echo "  - JWT_SECRET (change this!)"
    echo "  - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"
    echo "  - Google Maps API keys"
    echo "  - SendGrid API key"
    read -p "Press Enter to continue after updating .env.production..."
fi

# Frontend Setup
print_status "Setting up frontend..."
cd "$FRONTEND_DIR"

# Install frontend dependencies
print_status "Installing frontend dependencies..."
npm install --production

# Create production environment file if it doesn't exist
if [ ! -f ".env.production.local" ]; then
    print_warning "Creating .env.production.local file..."
    cp .env.local .env.production.local
    print_warning "Please update .env.production.local with production API URL!"
    read -p "Press Enter to continue after updating .env.production.local..."
fi

# Build frontend
print_status "Building frontend..."
npm run build

# Install PM2 if not installed
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2..."
    sudo npm install -g pm2
fi

# Start applications with PM2
print_status "Starting applications with PM2..."

# Start backend
cd "$BACKEND_DIR"
pm2 start server.js --name "autobacs-backend" --env production

# Start frontend
cd "$FRONTEND_DIR"
pm2 start npm --name "autobacs-frontend" -- start

# Save PM2 configuration
pm2 startup
pm2 save

print_status "Applications started successfully!"

# Display status
echo ""
print_status "Deployment Status:"
echo "=================="
pm2 list

echo ""
print_status "Next Steps:"
echo "==========="
echo "1. Configure Nginx reverse proxy"
echo "2. Set up SSL certificate with Let's Encrypt"
echo "3. Update domain in environment files"
echo "4. Test all functionality"
echo "5. Set up monitoring and backups"

echo ""
print_status "Useful PM2 Commands:"
echo "  pm2 status          # View application status"
echo "  pm2 logs            # View application logs"
echo "  pm2 restart all     # Restart all applications"
echo "  pm2 stop all        # Stop all applications"

echo ""
print_status "Deployment completed successfully! 🎉"