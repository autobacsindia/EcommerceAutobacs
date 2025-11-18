# Autobacs India - Frontend

React-based user interface for the Autobacs India e-commerce platform.

## Setup

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm start
```

The application will open at `http://localhost:3000`

### Build for Production
```bash
npm run build
```

### Run Tests
```bash
npm test
```

## Project Structure

```
client/
├── public/
│   ├── index.html           # HTML template
│   ├── manifest.json        # PWA manifest
│   └── robots.txt           # SEO robots file
├── src/
│   ├── components/          # Reusable React components (planned)
│   ├── pages/              # Page components (planned)
│   ├── services/           # API integration layer (planned)
│   ├── context/            # React Context for state (planned)
│   ├── App.js              # Main app component
│   ├── App.css             # App styles
│   ├── index.js            # React entry point
│   └── index.css           # Global styles
└── package.json            # Dependencies
```

## Tech Stack

- **React 19.2** - UI library
- **React Router DOM 7.9** - Client-side routing
- **Tailwind CSS 4.1** - Utility-first CSS framework
- **Lucide React** - Icon library
- **React Icons** - Additional icons
- **Firebase** - Authentication and services

## Styling

This project uses **Tailwind CSS** for styling. Tailwind utilities can be used directly in JSX:

```jsx
<button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
  Click Me
</button>
```

## Planned Features

### Pages
- Home/Landing page
- Product catalog/shop
- Product detail page
- Shopping cart
- Checkout
- User dashboard
- Admin panel

### Components
- Header/Navigation
- Footer
- Product card
- Product filters
- Shopping cart widget
- Forms (login, register, checkout)
- Modals and dialogs

### State Management
- Authentication context
- Shopping cart context
- User preferences

## API Integration

The frontend communicates with the backend API at `http://localhost:5000`

API services will be organized in the `src/services/` directory.

## Available Scripts

- `npm start` - Run development server
- `npm run build` - Build for production
- `npm test` - Run test suite
- `npm run eject` - Eject from Create React App (one-way operation)
