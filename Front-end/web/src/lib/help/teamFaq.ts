/**
 * The team panel's Help page (/team/help), as data.
 *
 * Plain answers to "how do I…" for every team, written the way the panel's own
 * page intros are worded, so the help and the screen never disagree. Links go
 * to the panel page that does the thing. Staff only: /team is behind sign-in,
 * noindex (app/team/layout.tsx) and disallowed in robots.ts — never put this in
 * the sitemap or the public FAQ.
 */

export interface TeamHelpLink {
  label: string;
  href: string;
}

export interface TeamHelpItem {
  question: string;
  /** One paragraph, or several steps when the order matters. */
  answer: string | string[];
  links?: TeamHelpLink[];
}

export interface TeamHelpSection {
  /** Anchor on /team/help. */
  id: string;
  title: string;
  /** Who this section is mainly for, shown under the title. */
  forWho: string;
  items: TeamHelpItem[];
}

export const TEAM_HELP: TeamHelpSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    forWho: 'Everyone',
    items: [
      {
        question: 'What is on my menu?',
        answer: 'Each team sees its own tools. Everyone has the Dashboard, Team chat, Tasks, Payments (for expenses), My team and this Help page. GTM sees the selling tools, procurement sees Orders and Suppliers, accounts sees Refund approvals and Bank transfers, and operations sees Deliveries.',
      },
      {
        question: 'How do I check something on the website?',
        answer: 'Press "View website" at the top of any page. It opens the store in a new tab, so you keep your place in the panel.',
      },
      {
        question: 'What does the bell show?',
        answer: 'Everything waiting for you: approvals, refunds, unread chat. Tap an item to go straight to it.',
      },
      {
        question: 'How do I get pop-up notifications?',
        answer: 'Allow notifications when the panel asks. If you blocked them by mistake, tap the lock icon next to the web address and allow notifications for this site, then reload the page.',
      },
      {
        question: 'How do I change my password?',
        answer: 'Use "Change password" at the bottom of the menu. Company accounts do not have it — the admin manages their password.',
        links: [{ label: 'Change password', href: '/team/password' }],
      },
    ],
  },
  {
    id: 'orders',
    title: 'Orders and stages',
    forWho: 'Everyone',
    items: [
      {
        question: 'What do the stage colours mean?',
        answer: [
          'New Order (orange) — paid, waiting for procurement to check stock.',
          'In Stock (yellow) — the supplier has it.',
          'Our Warehouse (teal) — we have it ourselves; pack it and dispatch it.',
          'Payment Pending (red) — a supplier payment was requested and is waiting to be paid.',
          'Ordered From Supplier (dark yellow) — the supplier is paid and sending it.',
          'Dispatched (green) — on its way to the customer.',
          'Delivered (dark green) — done.',
          'Pink and purple — out of stock, or a refund in progress.',
        ],
      },
      {
        question: 'Where do I see the whole story of an order?',
        answer: 'Open the order. The Order journey at the top shows every step from left to right, with who did it and when. Refunds and cancellations show on their own line.',
        links: [{ label: 'Order processing', href: '/team/orders' }],
      },
      {
        question: 'What is the difference between "Purchase order" and "Procurement order"?',
        answer: 'A Purchase order (blue tag) is a customer buying from us. A Procurement order (purple tag) is us buying from a supplier — a supplier payment request.',
      },
      {
        question: 'I pressed the wrong button. Can I undo it?',
        answer: [
          'A stock decision has an Undo button until the next step happens.',
          'A customer\'s decision (wait or refund) can be undone until accounts acts on it.',
          'Dispatch details (courier, tracking number) can be corrected while the parcel is in transit.',
          'A parcel marked delivered by mistake can be put back in transit.',
        ],
      },
    ],
  },
  {
    id: 'selling',
    title: 'Selling',
    forWho: 'GTM',
    items: [
      {
        question: 'A customer called or messaged. How do I sell to them?',
        answer: 'Go to New quotation, add the products and share the quotation PDF. When the customer agrees, create the order and share how to pay.',
        links: [{ label: 'New quotation', href: '/team/sales/new' }, { label: 'Quotations', href: '/team/sales/quotations' }],
      },
      {
        question: 'The customer wants to pay right now.',
        answer: 'Use Payment first: choose the products, create the order, then share our bank details or GPay QR. Accounts confirms the payment as usual.',
        links: [{ label: 'Payment first', href: '/team/sales/pay-first' }],
      },
      {
        question: 'How do I give a discount on the whole quotation?',
        answer: 'In the quotation, fill in "Discount %" and the reason. Example: 5% on ₹11,800 takes ₹590 off, so the customer pays ₹11,210. The customer sees "Discount (5%)"; your name and the reason are shown to the team only.',
        links: [{ label: 'New quotation', href: '/team/sales/new' }],
      },
      {
        question: 'The customer accepted, but now wants a change.',
        answer: 'Open the quotation and choose Edit quotation. Saving cancels the unpaid order and every payment link already sent, and the quotation goes back to waiting for the customer as a new version. Share it again and accept it when they agree. This is not possible once any money is received or a bank transfer is waiting for accounts.',
        links: [{ label: 'Quotations', href: '/team/sales/quotations' }],
      },
      {
        question: 'The customer already paid (bank transfer, GPay or UPI) and sent a receipt.',
        answer: 'Open the order and choose "Customer already paid — attach receipt". Type the UTR or UPI reference and attach the receipt: a screenshot or a PDF, up to 20 files. The order is paid only after accounts finds the money in the bank and confirms it; you can follow it under Bank transfers. (The "GPay / UPI QR" box is only for a picture of our own QR, which the customer scans to pay.)',
        links: [{ label: 'My orders', href: '/team/sales' }, { label: 'Bank transfers', href: '/team/bank-transfers' }],
      },
      {
        question: 'What is "Customer decisions"?',
        answer: 'Items procurement could not get. Call the customer and record their answer: they will wait for stock, or they want a refund.',
        links: [{ label: 'Customer decisions', href: '/team/decisions' }],
      },
    ],
  },
  {
    id: 'procurement',
    title: 'Procurement and supplier payments',
    forWho: 'Procurement',
    items: [
      {
        question: 'How do I process a new order?',
        answer: [
          'Open Orders and check stock for each product.',
          'In stock — the supplier has it.',
          'Our warehouse — we hold it; pack it and dispatch it with the courier and tracking number.',
          'Out of stock — nobody has it; GTM then asks the customer to wait or take a refund.',
        ],
        links: [{ label: 'Orders', href: '/team/procurement' }],
      },
      {
        question: 'How do I pay a supplier?',
        answer: 'On the product line, press "Request supplier payment", pick the supplier (or "Same supplier as before") and attach the bill. The line shows Payment Pending; accounts approves, the admin pays, and it moves to Ordered From Supplier.',
        links: [{ label: 'Orders', href: '/team/procurement' }, { label: 'Payments', href: '/team/payments' }],
      },
      {
        question: 'How do I add a supplier?',
        answer: 'Save the supplier once under Suppliers, with their bank or UPI details. After that, just pick them from the list.',
        links: [{ label: 'Suppliers', href: '/team/suppliers' }],
      },
      {
        question: 'The supplier has dispatched it.',
        answer: 'Upload the supplier\'s dispatch photo with the courier name and tracking number. The order moves to Dispatched and operations follows it from there.',
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    forWho: 'Accounts',
    items: [
      {
        question: 'Which payment requests do I approve?',
        answer: 'Every request from every team — supplier payments and expenses. Approve it, decline it with a reason, or put it on hold. The admin pays what you approve and records the reference and screenshot.',
        links: [{ label: 'Payments', href: '/team/payments' }],
      },
      {
        question: 'How do refund approvals work?',
        answer: 'These are refunds the customer asked for. Once you approve, the item is cancelled and the refund goes out to the customer. If sending fails, you can retry it from the order.',
        links: [{ label: 'Refund approvals', href: '/team/refunds' }],
      },
      {
        question: 'How do I confirm a bank transfer?',
        answer: 'Open Bank transfers and confirm a payment only after you have found the money in the bank. Until then the order stays unpaid.',
        links: [{ label: 'Bank transfers', href: '/team/bank-transfers' }],
      },
    ],
  },
  {
    id: 'operations',
    title: 'Deliveries',
    forWho: 'Operations',
    items: [
      {
        question: 'How do I follow a parcel?',
        answer: 'Under Deliveries, update each parcel as it moves — picked up, in transit, out for delivery, or delivery failed. The customer sees each update. Mark it delivered when it arrives.',
        links: [{ label: 'Deliveries', href: '/team/deliveries' }],
      },
      {
        question: 'How do I set the expected delivery date?',
        answer: 'Set it on the parcel in Deliveries. Late and due-today parcels are flagged so nothing slips.',
        links: [{ label: 'Deliveries', href: '/team/deliveries' }],
      },
    ],
  },
  {
    id: 'expenses',
    title: 'Expenses, chat and tasks',
    forWho: 'Everyone',
    items: [
      {
        question: 'I paid for fuel, a courier or a tool. How do I get it back?',
        answer: 'Go to Payments, press "New expense", choose what it was for (each team has its own list; "Others" needs a few words of details), enter the amount and who was paid, and attach the bill. Procurement can pick the bill’s currency (e.g. Thai baht) and enter the rate from the bank or forex quote — the rupee amount is worked out from them. It goes to accounts to approve, then to the admin to pay. You can download the slip or receipt at any stage.',
        links: [{ label: 'Payments', href: '/team/payments' }],
      },
      {
        question: 'Can I edit or delete a chat message?',
        answer: 'Yes, within 30 minutes of sending it. After that it stays as it is.',
        links: [{ label: 'Team chat', href: '/team/chat' }],
      },
      {
        question: 'How do tasks work?',
        answer: 'Press "New task" and pick a due date. Team heads and the admin can give jobs to other people; everyone can add jobs for themselves. Tick the circle when a job is done; open a task to comment, add steps or change it.',
        links: [{ label: 'Tasks', href: '/team/tasks' }],
      },
    ],
  },
];
