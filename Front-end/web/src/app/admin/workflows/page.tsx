'use client';

import { useState } from 'react';
import { Package, ShoppingCart, Truck, CheckCircle, XCircle, ArrowRight, RefreshCw } from 'lucide-react';

type WorkflowType = 'product' | 'order' | 'inventory';

export default function WorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType>('product');

  const workflows = [
    { id: 'product' as WorkflowType, label: 'Product Lifecycle', icon: Package },
    { id: 'order' as WorkflowType, label: 'Order Fulfillment', icon: ShoppingCart },
    { id: 'inventory' as WorkflowType, label: 'Inventory Management', icon: Truck },
  ];

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Production Workflows & Process Visualization</h1>

      {/* Workflow Tabs */}
      <div className="mb-8 flex gap-4">
        {workflows.map((workflow) => {
          const Icon = workflow.icon;
          return (
            <button
              key={workflow.id}
              onClick={() => setSelectedWorkflow(workflow.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition ${
                selectedWorkflow === workflow.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-5 w-5" />
              {workflow.label}
            </button>
          );
        })}
      </div>

      {/* Workflow Content */}
      <div className="bg-white rounded-lg shadow-lg p-8">
        {selectedWorkflow === 'product' && <ProductLifecycleFlow />}
        {selectedWorkflow === 'order' && <OrderFulfillmentFlow />}
        {selectedWorkflow === 'inventory' && <InventoryManagementFlow />}
      </div>
    </div>
  );
}

function ProductLifecycleFlow() {
  const stages = [
    {
      title: 'Product Creation',
      status: 'Create',
      description: 'Admin creates product with details, images, pricing',
      color: 'bg-blue-500',
      icon: Package,
      actions: ['Add product info', 'Upload images', 'Set pricing', 'Define specifications'],
    },
    {
      title: 'Categorization',
      status: 'Categorize',
      description: 'Assign to categories and add tags',
      color: 'bg-purple-500',
      icon: Package,
      actions: ['Select category', 'Add tags', 'Set brand', 'Link related products'],
    },
    {
      title: 'Inventory Setup',
      status: 'Stock',
      description: 'Set initial stock and warehouse location',
      color: 'bg-yellow-500',
      icon: Package,
      actions: ['Set stock quantity', 'Assign warehouse', 'Set reorder level', 'Define SKU'],
    },
    {
      title: 'Activation',
      status: 'Activate',
      description: 'Make product live and searchable',
      color: 'bg-green-500',
      icon: CheckCircle,
      actions: ['Mark as active', 'Enable search indexing', 'Set featured status'],
    },
    {
      title: 'Live Sales',
      status: 'Active',
      description: 'Product available for purchase',
      color: 'bg-teal-500',
      icon: ShoppingCart,
      actions: ['Customer orders', 'Stock decrements', 'Reviews collected'],
    },
    {
      title: 'Monitoring',
      status: 'Monitor',
      description: 'Track performance and inventory',
      color: 'bg-indigo-500',
      icon: RefreshCw,
      actions: ['Sales analytics', 'Stock alerts', 'Price adjustments', 'Restock triggers'],
    },
    {
      title: 'Deactivation/Archive',
      status: 'End',
      description: 'Product discontinued or out of stock',
      color: 'bg-red-500',
      icon: XCircle,
      actions: ['Mark inactive', 'Archive data', 'Remove from search', 'Handle returns'],
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Product Lifecycle Workflow</h2>
      <p className="text-gray-600 mb-8">
        Complete journey of a product from creation to deactivation in the Autobacs system.
      </p>

      {/* Timeline Visualization */}
      <div className="space-y-6">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={index}>
              <div className="flex items-start gap-6">
                {/* Stage Number & Icon */}
                <div className="flex flex-col items-center">
                  <div className={`${stage.color} w-12 h-12 rounded-full flex items-center justify-center text-white font-bold`}>
                    {index + 1}
                  </div>
                  {index < stages.length - 1 && (
                    <div className="w-1 h-20 bg-gray-300 mt-2"></div>
                  )}
                </div>

                {/* Stage Content */}
                <div className="flex-1 pb-8">
                  <div className="bg-gray-50 rounded-lg p-6 border-l-4" style={{ borderColor: stage.color.replace('bg-', '#') }}>
                    <div className="flex items-center gap-3 mb-3">
                      <Icon className="h-6 w-6 text-gray-700" />
                      <h3 className="text-xl font-bold text-gray-900">{stage.title}</h3>
                      <span className={`${stage.color} text-white text-xs px-3 py-1 rounded-full`}>
                        {stage.status}
                      </span>
                    </div>
                    <p className="text-gray-600 mb-4">{stage.description}</p>
                    
                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2">
                      {stage.actions.map((action, actionIndex) => (
                        <div key={actionIndex} className="flex items-center gap-2 text-sm text-gray-700">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          {action}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Key Metrics */}
      <div className="mt-12 grid grid-cols-3 gap-6">
        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
          <div className="text-blue-600 text-sm font-medium mb-1">Average Time to Activate</div>
          <div className="text-3xl font-bold text-blue-900">2-3 days</div>
        </div>
        <div className="bg-green-50 p-6 rounded-lg border border-green-200">
          <div className="text-green-600 text-sm font-medium mb-1">Active Products</div>
          <div className="text-3xl font-bold text-green-900">85%</div>
        </div>
        <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
          <div className="text-purple-600 text-sm font-medium mb-1">Average Product Lifespan</div>
          <div className="text-3xl font-bold text-purple-900">18 months</div>
        </div>
      </div>
    </div>
  );
}

function OrderFulfillmentFlow() {
  const stages = [
    {
      title: 'Order Placed',
      status: 'pending',
      description: 'Customer completes checkout',
      color: 'bg-yellow-500',
      duration: '< 1 min',
      actions: ['Cart submitted', 'Payment initiated', 'Order number generated', 'Email sent to customer'],
    },
    {
      title: 'Payment Verification',
      status: 'confirming',
      description: 'Payment gateway processes transaction',
      color: 'bg-orange-500',
      duration: '2-5 min',
      actions: ['Gateway verification', 'Payment success/failure', 'Stock reserved', 'Invoice generated'],
    },
    {
      title: 'Order Confirmed',
      status: 'confirmed',
      description: 'Payment successful, order confirmed',
      color: 'bg-blue-500',
      duration: '< 1 min',
      actions: ['Inventory updated', 'Warehouse notified', 'Confirmation email sent', 'Order in queue'],
    },
    {
      title: 'Processing',
      status: 'processing',
      description: 'Warehouse picks and packs items',
      color: 'bg-indigo-500',
      duration: '4-24 hours',
      actions: ['Items picked', 'Quality check', 'Packing', 'Label printed'],
    },
    {
      title: 'Shipped',
      status: 'shipped',
      description: 'Handed over to carrier',
      color: 'bg-purple-500',
      duration: '1-2 hours',
      actions: ['Carrier pickup', 'Tracking number assigned', 'Shipping notification sent', 'ETA calculated'],
    },
    {
      title: 'In Transit',
      status: 'in_transit',
      description: 'Package being delivered',
      color: 'bg-cyan-500',
      duration: '2-7 days',
      actions: ['Tracking updates', 'Location updates', 'Delay notifications', 'Customer tracking'],
    },
    {
      title: 'Delivered',
      status: 'delivered',
      description: 'Package received by customer',
      color: 'bg-green-500',
      duration: '< 1 min',
      actions: ['Delivery confirmation', 'Signature collected', 'Status updated', 'Review request sent'],
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Order Fulfillment Workflow</h2>
      <p className="text-gray-600 mb-8">
        Complete order processing flow from customer checkout to delivery.
      </p>

      {/* Flow Diagram */}
      <div className="mb-12 overflow-x-auto">
        <div className="flex items-center gap-4 min-w-max pb-4">
          {stages.map((stage, index) => (
            <div key={index} className="flex items-center">
              {/* Stage Box */}
              <div className="w-64 bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition">
                <div className={`${stage.color} w-10 h-10 rounded-full flex items-center justify-center text-white font-bold mb-3`}>
                  {index + 1}
                </div>
                <h3 className="font-bold text-gray-900 mb-1">{stage.title}</h3>
                <p className="text-sm text-gray-600 mb-2">{stage.description}</p>
                <div className={`${stage.color} bg-opacity-20 text-xs px-2 py-1 rounded inline-block`}>
                  {stage.status.toUpperCase()}
                </div>
                <div className="mt-2 text-xs text-gray-500">⏱️ {stage.duration}</div>
              </div>

              {/* Arrow */}
              {index < stages.length - 1 && (
                <ArrowRight className="h-8 w-8 text-gray-400 mx-2" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Actions */}
      <div className="grid grid-cols-2 gap-6">
        {stages.map((stage, index) => (
          <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <div className={`${stage.color} w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold`}>
                {index + 1}
              </div>
              <h4 className="font-semibold text-gray-900">{stage.title}</h4>
            </div>
            <ul className="space-y-1">
              {stage.actions.map((action, actionIndex) => (
                <li key={actionIndex} className="text-sm text-gray-600 flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Performance Metrics */}
      <div className="mt-12 grid grid-cols-4 gap-6">
        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
          <div className="text-blue-600 text-sm font-medium mb-1">Avg. Processing Time</div>
          <div className="text-2xl font-bold text-blue-900">18 hours</div>
        </div>
        <div className="bg-green-50 p-6 rounded-lg border border-green-200">
          <div className="text-green-600 text-sm font-medium mb-1">On-Time Delivery</div>
          <div className="text-2xl font-bold text-green-900">92%</div>
        </div>
        <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
          <div className="text-purple-600 text-sm font-medium mb-1">Avg. Delivery Time</div>
          <div className="text-2xl font-bold text-purple-900">4.5 days</div>
        </div>
        <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
          <div className="text-orange-600 text-sm font-medium mb-1">Cancellation Rate</div>
          <div className="text-2xl font-bold text-orange-900">2.3%</div>
        </div>
      </div>
    </div>
  );
}

function InventoryManagementFlow() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Inventory Management Workflow</h2>
      <p className="text-gray-600 mb-8">
        Automated inventory tracking and replenishment process.
      </p>

      {/* Main Flow Diagram */}
      <div className="mb-12">
        <div className="grid grid-cols-3 gap-6">
          {/* Stock Monitoring */}
          <div className="col-span-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-6 border-2 border-blue-300">
            <h3 className="text-xl font-bold text-blue-900 mb-4">1. Continuous Stock Monitoring</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Real-time Tracking</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Monitor stock levels</li>
                  <li>• Track SKU movements</li>
                  <li>• Warehouse locations</li>
                  <li>• Multi-location sync</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Automated Alerts</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Low stock warnings</li>
                  <li>• Out of stock alerts</li>
                  <li>• Overstock notifications</li>
                  <li>• Expiry warnings</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Analytics</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Sales velocity</li>
                  <li>• Turnover rate</li>
                  <li>• Demand forecasting</li>
                  <li>• Trend analysis</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Reorder Trigger */}
          <div className="col-span-3 bg-gradient-to-r from-yellow-50 to-yellow-100 rounded-lg p-6 border-2 border-yellow-300">
            <h3 className="text-xl font-bold text-yellow-900 mb-4">2. Reorder Point Triggered</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Automatic Detection</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Stock below reorder level</li>
                  <li>• Forecasted demand increase</li>
                  <li>• Seasonal adjustments</li>
                  <li>• Safety stock calculations</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Notification Sent</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Email to purchasing team</li>
                  <li>• Dashboard alert</li>
                  <li>• Mobile notification</li>
                  <li>• Supplier notification (auto)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Purchase Order */}
          <div className="col-span-3 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg p-6 border-2 border-purple-300">
            <h3 className="text-xl font-bold text-purple-900 mb-4">3. Purchase Order Creation</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Order Generation</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Auto-calculate quantity</li>
                  <li>• Select supplier</li>
                  <li>• Price comparison</li>
                  <li>• Lead time consideration</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Approval Flow</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Manager approval</li>
                  <li>• Budget check</li>
                  <li>• Supplier confirmation</li>
                  <li>• Order placement</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Tracking</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• PO number assigned</li>
                  <li>• Expected delivery date</li>
                  <li>• Shipment tracking</li>
                  <li>• Status updates</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Stock Receipt */}
          <div className="col-span-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-6 border-2 border-green-300">
            <h3 className="text-xl font-bold text-green-900 mb-4">4. Stock Receipt & Update</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Receiving</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Physical count</li>
                  <li>• Quality inspection</li>
                  <li>• Damage check</li>
                  <li>• Barcode scanning</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">System Update</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Stock levels updated</li>
                  <li>• Location assignment</li>
                  <li>• Batch/lot tracking</li>
                  <li>• Inventory sync</li>
                </ul>
              </div>
              <div className="bg-white rounded p-4">
                <div className="font-semibold text-gray-900 mb-2">Completion</div>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• PO marked complete</li>
                  <li>• Invoice matching</li>
                  <li>• Payment processing</li>
                  <li>• Audit trail created</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Events & Triggers */}
      <div className="mb-12">
        <h3 className="text-xl font-bold mb-4">Inventory Events & Automated Actions</h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-red-50 rounded-lg p-6 border-l-4 border-red-500">
            <h4 className="font-bold text-red-900 mb-3">Critical Events</h4>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Out of Stock</div>
                  <div className="text-sm text-gray-600">→ Mark unavailable, notify customers, urgent reorder</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Stock Discrepancy</div>
                  <div className="text-sm text-gray-600">→ Trigger audit, freeze updates, investigate</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Damaged Stock</div>
                  <div className="text-sm text-gray-600">→ Quarantine items, adjust inventory, insurance claim</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-green-50 rounded-lg p-6 border-l-4 border-green-500">
            <h4 className="font-bold text-green-900 mb-3">Optimization Actions</h4>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Slow Moving Stock</div>
                  <div className="text-sm text-gray-600">→ Suggest promotions, clearance sales, bundling</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Overstock</div>
                  <div className="text-sm text-gray-600">→ Adjust pricing, marketing push, warehouse optimization</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <div className="font-medium text-gray-900">Stock Transfer</div>
                  <div className="text-sm text-gray-600">→ Balance between warehouses, optimize distribution</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-4 gap-6">
        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
          <div className="text-blue-600 text-sm font-medium mb-1">Stock Accuracy</div>
          <div className="text-2xl font-bold text-blue-900">98.5%</div>
          <div className="text-xs text-gray-600 mt-1">System vs Physical</div>
        </div>
        <div className="bg-green-50 p-6 rounded-lg border border-green-200">
          <div className="text-green-600 text-sm font-medium mb-1">Inventory Turnover</div>
          <div className="text-2xl font-bold text-green-900">6.2x</div>
          <div className="text-xs text-gray-600 mt-1">Per year</div>
        </div>
        <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
          <div className="text-yellow-600 text-sm font-medium mb-1">Stockout Rate</div>
          <div className="text-2xl font-bold text-yellow-900">1.8%</div>
          <div className="text-xs text-gray-600 mt-1">Target: {'<'}2%</div>
        </div>
        <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
          <div className="text-purple-600 text-sm font-medium mb-1">Avg. Replenish Time</div>
          <div className="text-2xl font-bold text-purple-900">7 days</div>
          <div className="text-xs text-gray-600 mt-1">Order to receipt</div>
        </div>
      </div>
    </div>
  );
}
