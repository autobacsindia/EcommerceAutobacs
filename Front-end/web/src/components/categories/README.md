# Category Components

## CategoryCard Component

The [CategoryCard] component displays a single category with its image and description. It's used to show categories in a grid layout.

### Features

1. **Image Display**: Shows category image with fallback when no image is available
2. **Link Navigation**: Links to the products page filtered by category
3. **Responsive Design**: Works well on all screen sizes
4. **Hover Effects**: Interactive hover states for better UX

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| category | Category | Yes | The category object to display |

## OrganizedCategoryGrid Component

The [OrganizedCategoryGrid] component displays categories in a structured hierarchy based on the predefined organization:
- ACCESSORIES
- EXTERIOR (with BODYKIT and LIGHTS subcategories)
- INTERIOR (with AUDIO subcategory)
- PERFORMANCE (with SUSPENSION subcategory)

### Features

1. **Hierarchical Display**: Shows main categories with their subcategories
2. **Predefined Organization**: Follows the specific category structure requested
3. **Fallback Handling**: Shows "Other Categories" section for uncategorized items
4. **Responsive Grid**: Adapts layout based on screen size

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| categories | Category[] | Yes | Array of all categories to organize |

## HierarchicalCategoryView Component

The [HierarchicalCategoryView] component displays categories in a collapsible tree structure, showing parent-child relationships.

### Features

1. **Tree Structure**: Displays categories in a hierarchical tree view
2. **Expand/Collapse**: Users can expand or collapse category branches
3. **Nested Display**: Shows subcategories indented under their parents
4. **Interactive Controls**: Clear visual indicators for expandable items

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| categories | Category[] | Yes | Array of all categories to display hierarchically |

## Category Structure

The components are designed to work with the following category hierarchy:

```
ACCESSORIES
EXTERIOR
├── BODYKIT
└── LIGHTS
INTERIOR
└── AUDIO
PERFORMANCE
└── SUSPENSION
```

Each main category is displayed prominently, with its subcategories shown in a secondary grid below.