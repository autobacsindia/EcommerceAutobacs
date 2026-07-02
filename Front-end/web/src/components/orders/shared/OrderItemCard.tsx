'use client';

import { Package } from 'lucide-react';

interface OrderItem {
  _id: string;
  product?: {
    _id: string;
    name: string;
    price: number;
    images?: Array<{ url: string; alt?: string }>;
  };
  quantity: number;
  price: number;
  name?: string;
  image?: string;
}

interface OrderItemCardProps {
  item: OrderItem;
  mode?: 'display' | 'select' | 'quantity';
  selected?: boolean;
  selectedQuantity?: number;
  onSelect?: (selected: boolean) => void;
  onQuantityChange?: (quantity: number) => void;
}

export default function OrderItemCard({
  item,
  mode = 'display',
  selected = false,
  selectedQuantity = 1,
  onSelect,
  onQuantityChange,
}: OrderItemCardProps) {
  const product = item.product;
  const productName = product?.name || item.name || 'Unknown Product';
  const productImage = product?.images?.[0]?.url || item.image;
  const unitPrice = item.price;
  const maxQuantity = item.quantity;

  const handleQuantityChange = (newQuantity: number) => {
    if (newQuantity >= 1 && newQuantity <= maxQuantity && onQuantityChange) {
      onQuantityChange(newQuantity);
    }
  };

  return (
    <div
      className={`flex gap-4 p-4 border rounded-lg transition ${
        mode === 'select'
          ? selected
            ? 'border-gold bg-gold/10'
            : 'border-hairline hover:border-hairline'
          : 'border-hairline'
      }`}
    >
      {/* Checkbox for select mode */}
      {mode === 'select' && onSelect && (
        <div className="flex items-start pt-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="h-5 w-5 text-gold focus:ring-gold rounded"
          />
        </div>
      )}

      {/* Product Image */}
      <div className="w-20 h-20 bg-obsidian-raised rounded-lg overflow-hidden flex-shrink-0">
        {productImage ? (
          <img
            src={productImage}
            alt={productName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-muted">
            <Package className="h-8 w-8" />
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-ink truncate">{productName}</h4>
        <p className="text-sm text-ink-muted mt-1">
          Price: ₹{unitPrice.toFixed(2)} each
        </p>
        
        {/* Quantity Display/Selector */}
        {mode === 'display' && (
          <p className="text-sm text-ink-muted">Quantity: {item.quantity}</p>
        )}
        
        {mode === 'select' && selected && (
          <p className="text-sm text-ink-muted">Available: {maxQuantity}</p>
        )}

        {mode === 'quantity' && onQuantityChange && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-sm text-ink-muted">Quantity:</label>
            <div className="flex items-center border border-hairline rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => handleQuantityChange(selectedQuantity - 1)}
                disabled={selectedQuantity <= 1}
                className="px-3 py-1 bg-obsidian-raised hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                -
              </button>
              <input
                type="number"
                value={selectedQuantity}
                onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                min={1}
                max={maxQuantity}
                className="w-16 text-center border-x border-hairline py-1 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleQuantityChange(selectedQuantity + 1)}
                disabled={selectedQuantity >= maxQuantity}
                className="px-3 py-1 bg-obsidian-raised hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                +
              </button>
            </div>
            <span className="text-xs text-ink-muted">of {maxQuantity}</span>
          </div>
        )}
      </div>

      {/* Total Price */}
      <div className="text-right">
        <p className="font-bold text-lg text-ink">
          ₹{(unitPrice * (mode === 'quantity' ? selectedQuantity : item.quantity)).toFixed(2)}
        </p>
        {mode === 'quantity' && (
          <p className="text-xs text-ink-muted mt-1">
            {selectedQuantity} × ₹{unitPrice.toFixed(2)}
          </p>
        )}
      </div>
    </div>
  );
}
