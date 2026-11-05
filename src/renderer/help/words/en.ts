// src/renderer/help/words/en.ts
//
// Every word of the guide in English. Rules (read before editing):
//  - Short sentences. One action per sentence. Everyday words.
//  - Button and screen names exactly as the till shows them, in **bold**.
//    Copy them from src/renderer/i18n/strings*.ts, never from memory.
//  - Say what an action CHANGES (next) and what can go WRONG (careful).
//  - Never write a rule the app does not have. Unsure? It goes in
//    docs/HELP-GUIDE-QUESTIONS.md, not here.
//  - The support phone number lives ONLY in ui.stillNotWorking.
import type { HelpWords } from '../types';

export const en: HelpWords = {
  ui: {
    help: 'Help',
    title: 'User guide',
    subtitle: 'How to use the till, step by step.',
    search: 'Search the guide…',
    noResults: 'Nothing found. Try another word.',
    results: '{n} results',
    firstDay: 'Your first day',
    firstDayHint: 'Start here. A short path for your job.',
    yourJob: 'Your job',
    wrong: 'Something went wrong',
    wrongHint: 'Find your problem. Do the first check first.',
    allTopics: 'All topics',
    summary: 'Summary',
    detailed: 'Detailed',
    prev: 'Previous',
    next: 'Next',
    back: 'Back to guide',
    close: 'Close',
    steps: 'Steps',
    whatNext: 'What happens next',
    careful: 'Be careful',
    stepOf: 'Step {n} of {total}',
    stepsCount: '{n} steps',
    stillNotWorking:
      "Still not working? Ask your manager. If they can't fix it, call Majestic on +965 2241 5093.",
    openHelp: 'Help for this screen',
    picture: 'Picture',
    why: 'Why today',
    goBack: 'Go back',
  },

  jobs: {
    cashier: { title: 'Cashier', blurb: 'Take orders and payments.' },
    kitchen: { title: 'Kitchen', blurb: 'Read orders and mark them ready.' },
    manager: { title: 'Branch manager', blurb: 'Approve, check and close the day.' },
  },

  firstDay: {
    cashier: {
      'start.sign-in': 'Every order you take is saved with your name.',
      'start.check-till': 'Make sure the till is on the right shop before you sell.',
      'order.new-order': 'Every sale starts here.',
      'order.find-dish': 'This is how you add what the customer wants.',
      'order.options': 'Many dishes ask for a size or add-ons.',
      'pay.place': 'This saves the sale and prints the receipt.',
      'pay.cash': 'Give the right change every time.',
      'pay.knet': 'Card payments must be marked paid with the slip number.',
      'offline.works': 'If the internet stops, you can keep selling.',
    },
    kitchen: {
      'start.sign-in': 'Sign in with your own name.',
      'start.check-till': 'Make sure the screen is on the right shop.',
      'kitchen.read': 'This is where new orders show up.',
      'kitchen.move': 'This tells everyone the food is ready.',
      'offline.works': 'The screen keeps working without the internet.',
      'trouble.missing-order': 'What to do when an order does not show.',
    },
    manager: {
      'start.test-print': 'Check the printer before the shop opens.',
      'change.approve': 'Staff need your code for some changes.',
      'change.cancel-manager': 'Only you can cancel a placed order.',
      'orders.find': 'Find any order of today in seconds.',
      'closing.read': 'See what the branch sold today.',
      'closing.print': 'The cashier signs this slip at the end of the day.',
      'manager.update': 'Install new versions at a quiet time.',
      'offline.waiting': 'Check that every order reached the back office.',
    },
  },

  topics: {
    /* ------------------------------------------------------------------ */
    start: {
      title: 'Start the day',
      blurb: 'Sign in and check the till is ready.',
      keywords: ['login', 'log in', 'morning', 'open'],
      steps: {
        'sign-in': {
          title: 'Sign in',
          summary: 'Sign in with your own name at the start of your work.',
          steps: [
            'Find your name under **Quick users**.',
            'Tap your name. The till fills in your email.',
            'Type your password.',
            'Tap **Sign in**.',
          ],
          next: [
            'Your name shows at the top of the side menu.',
            'Every order you take is saved with your name.',
          ],
          careful: [
            'Always sign in as yourself. Never use another person’s name.',
            'Staff can only sign in at their own branch.',
            'If the screen says **Caps Lock is ON**, press the Caps Lock key once. Then type your password again.',
          ],
          notes: ['Tap your name.', 'Type your password.', 'Tap **Sign in**.'],
          keywords: ['password', 'quick users', 'name'],
        },
        'check-till': {
          title: 'Check the till is ready',
          summary: 'Look at the box at the top of the side menu before you sell.',
          steps: [
            'Look at the box at the top of the side menu. If the menu shows only icons, tap **Expand sidebar** (the panel button at the top) to open it.',
            'Read the branch name. It must be your shop.',
            'On the second line, read the time next to the clock. It shows when the till last talked to the back office, for example **just now** or **2m ago**.',
            'To send and get orders now, tap the round arrow button next to the branch name.',
          ],
          next: [
            'The till sends your orders to the back office. It also gets menu changes from it.',
          ],
          careful: [
            'Green **Online** means the till can reach the back office. **Offline** means it cannot right now. You can still sell. See **No internet: keep selling**.',
            'If the branch name is wrong, do not take orders. Tell your manager.',
          ],
          notes: ['Your branch name.', 'When the till last talked to the back office.', '**Online**: the till can reach the back office.', 'Send and get orders now.'],
          keywords: ['sync', 'online', 'branch', 'connection', 'internet'],
        },
        'test-print': {
          title: 'Print a test receipt',
          summary: 'Check the receipt printer works before the shop opens.',
          steps: [
            'In the side menu, tap **Settings**.',
            'Find **Receipt printer**.',
            'Tap **Print a test receipt**.',
            'Check that a slip comes out.',
          ],
          next: ['Only a test slip prints. No order is made.'],
          careful: [
            'If nothing comes out, see **Something went wrong → Printer not printing**.',
          ],
          keywords: ['printer', 'test'],
        },
        pair: {
          title: 'Connect a new till',
          summary:
            'A new till must be connected to your branch one time. You need a code from the back office.',
          steps: [
            'On the back office website, open **POS devices** and click **Add a till to a branch**. Pick the branch there.',
            'On the till, type the **Server base URL** shown there.',
            'Type the **Pairing code**.',
            'Tap **Pair device**.',
            'Read the branch name the till shows. Make sure it is the right shop.',
            'Tap **Continue to login**.',
          ],
          next: [
            'The till gets the menu and the staff names.',
            'Every sale on this till is saved to that branch.',
          ],
          careful: [
            'The code works one time only. It stops working 30 minutes after it is made.',
            'If the branch name is wrong, do not take any orders. Unpair the till and ask for a new code.',
          ],
          keywords: ['pair', 'pairing', 'code', 'new till', 'setup'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    order: {
      title: 'Take an order',
      blurb: 'Start an order and add dishes, sizes and add-ons.',
      keywords: ['sell', 'sale', 'cart', 'basket'],
      steps: {
        'new-order': {
          title: 'Start a new order',
          summary: 'Every sale starts with a new order. Then pick the kind of order.',
          steps: [
            'In the side menu, tap **Order Process**.',
            'Tap **NEW** at the top.',
            'Pick the kind of order: **Pickup**, **Delivery** or **Dine-in**.',
          ],
          next: [
            'A new order opens on the right. It starts as **Pickup**.',
            'It also gets its own tab at the top of the screen.',
          ],
          careful: [
            '**Delivery** shows only if your branch delivers.',
            'For a table, you can also tap the table in the table bar. See **Dine-in tables**.',
          ],
          notes: ['Start a new order.', 'The kind of order.', 'The dishes in this order.', 'Place the order.'],
          keywords: ['new', 'pickup', 'takeaway', 'delivery', 'dine-in'],
        },
        'find-dish': {
          title: 'Find a dish',
          summary: 'Tap a category, search by name, or scan the barcode.',
          steps: [
            'Tap a category, or **All Categories**.',
            'Or type the dish name in the search box. English or Arabic both work.',
            'Or scan the barcode with the scanner.',
            'Tap the dish to add it.',
          ],
          next: ['The dish is added to the order on the right. The total goes up.'],
          careful: [
            'A dish marked **Out of Stock** cannot be added.',
            'If the till says **Unknown barcode**, that barcode is not on the menu. Find the dish by name, or tell your manager.',
          ],
          keywords: ['search', 'barcode', 'scan', 'item', 'product', 'category'],
        },
        options: {
          title: 'Sizes and add-ons',
          summary: 'Some dishes ask you to pick a size or add-ons first.',
          steps: [
            'Tap the dish. The **Customize your order** window opens.',
            'Pick a size under **Size / Variation**.',
            'Tap the add-ons the customer wants.',
            'Change the quantity if needed.',
            'Tap **Add to order**.',
          ],
          next: ['The dish is added with its size and add-ons. The price includes the add-ons.'],
          careful: [
            'A group marked **Required** needs a choice. You cannot add the dish without it.',
            'Some groups have a limit, for example **Max 2**.',
          ],
          notes: ['Pick the size.', 'Tap the add-ons.', 'Tap **Add to order**.'],
          keywords: ['size', 'addon', 'add-on', 'extra', 'variation', 'option'],
        },
        'change-line': {
          title: 'Change the quantity or remove a dish',
          summary: 'Use + and − to change how many. Use the bin to remove a dish.',
          steps: [
            'Find the dish in the order on the right.',
            'Tap **+** to add one more.',
            'Tap **−** to take one away.',
            'Tap the bin to remove the dish.',
          ],
          next: ['The total changes straight away.'],
          careful: [
            'After the order is placed, its dishes are locked. Removing one then needs a manager. See **Change or cancel**.',
            '**Clear cart** removes every dish. It asks you first. You cannot undo it.',
          ],
          keywords: ['quantity', 'qty', 'remove', 'delete', 'plus', 'minus'],
        },
        promo: {
          title: 'Use a promo code',
          summary: 'A promo code is the only way to give a discount on the till.',
          steps: [
            'Tap **Apply Promo Code**.',
            'Type the code, or tap one under **Available Promo Codes**.',
            'Tap **Apply Code**.',
          ],
          next: ['The code shows in the order. The total goes down.'],
          careful: [
            'If the till says **Invalid or inactive promo code.**, check the code with the customer.',
            'Some codes need a minimum total.',
            'To take the code off, tap the X next to it.',
          ],
          keywords: ['discount', 'coupon', 'promo', 'offer'],
        },
        delivery: {
          title: 'Delivery orders',
          summary: 'A delivery needs the customer’s address. The delivery fee comes from the area.',
          steps: [
            'Pick **Delivery** at the top.',
            'Add the dishes.',
            'Tap **Place order**.',
            'Type the customer’s mobile number. If the till knows the customer, it shows **Found:** and the name.',
            'Pick the **State**, **City** and **Block**. Fill in the street, building and floor.',
            'Pick the payment method. Tap **Place order**.',
          ],
          next: [
            'The delivery fee for the area is added to the total.',
            'The till shows the smallest order allowed for that area.',
          ],
          careful: [
            'You cannot close a delivery order without **State**, **City** and **Block**.',
            'To change the fee, tap the pencil next to **Delivery fee**. Pick **No charge**, **Use area fee**, or type an amount. Then tap **Save**. You can only change it before the order is placed.',
          ],
          keywords: ['address', 'area', 'block', 'delivery fee', 'driver'],
        },
        'many-orders': {
          title: 'Work on more than one order',
          summary: 'Each open order has a tab at the top of the screen.',
          steps: [
            'Look at the tabs at the top of the screen.',
            'Tap a tab to go back to that order.',
            'Tap **NEW** to start another one.',
          ],
          next: ['Orders are saved on the till. Nothing is lost when you switch.'],
          careful: [
            'Pickup and delivery orders leave the tabs when you place them. Find them in **Recent Orders**.',
            'Dine-in orders stay in the tabs until the table is freed.',
          ],
          keywords: ['tabs', 'switch', 'open orders'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    tables: {
      title: 'Dine-in tables',
      blurb: 'Seat a table, add more dishes, move or free it.',
      keywords: ['table', 'dine in', 'guests', 'restaurant'],
      steps: {
        seat: {
          title: 'Seat a table',
          summary: 'Open an order on a table for the guests.',
          steps: [
            'Tap a free table in the table bar at the top. A dine-in order opens for it.',
            'Or start a **Dine-in** order and tap **Assign Table**.',
            'Pick the table. Set **Covers** to the number of people.',
            'Add the dishes.',
          ],
          next: ['The table is marked as taken.'],
          careful: [
            'In the table window, the blue card is the table already on this order.',
          ],
          notes: ['Pick the floor.', 'Tap a free table.'],
          keywords: ['assign table', 'covers', 'seat'],
        },
        send: {
          title: 'Place the table’s order',
          summary: 'Tap Update / Pay. The first time, you add the customer details.',
          steps: [
            'Tap **Update / Pay**.',
            'Type the **Customer Name**. Pick the payment method.',
            'Tap **Place order**.',
          ],
          next: [
            'The order is placed and the receipt prints.',
            'The order stays open on the screen, so you can add more later.',
            'The dishes are now locked. You see **Main order locked (printed)**.',
          ],
          careful: [
            'Check the dishes before you tap **Place order**. After that, removing a dish needs a manager.',
          ],
          keywords: ['update', 'pay', 'send', 'place'],
        },
        more: {
          title: 'Add more dishes to a table',
          summary: 'Add the new dishes, then tap Update / Pay again.',
          steps: [
            'Tap the table, or its tab at the top.',
            'Add the new dishes. You see **1 new item pending**.',
            'Tap **Update / Pay**.',
          ],
          next: [
            'The new dishes are sent straight away. The receipt prints again.',
          ],
          careful: [
            'If the table pays by payment link, **Update / Pay** opens the full window again. A new link is needed for the new total.',
          ],
          keywords: ['round', 'add more', 'second order'],
        },
        move: {
          title: 'Move guests to another table',
          summary: 'Change the table on the open order.',
          steps: [
            'Open the table’s order.',
            'Tap the table button at the top of the order. It shows the table name and the number of people.',
            'Pick the new table.',
          ],
          next: [
            'The order moves to the new table.',
            'The old table becomes free.',
          ],
          careful: ['Check you picked the right table before you tap it.'],
          keywords: ['move', 'change table', 'transfer'],
        },
        release: {
          title: 'Finish and free the table',
          summary: 'When the guests leave, close the order and free the table.',
          steps: [
            'Open the table’s order.',
            'Tap **Close & Release**.',
            'Tap **Release table** to confirm.',
          ],
          next: [
            'The receipt prints.',
            'The order is closed and the table is free for new guests.',
          ],
          careful: [
            'Do this only when the guests have paid and are leaving.',
            'To free a table that has no dishes, tap the X next to the table name.',
          ],
          keywords: ['release', 'close table', 'free table', 'bill'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    pay: {
      title: 'Take payment',
      blurb: 'Place the order, take cash, KNET or a payment link.',
      keywords: ['payment', 'pay', 'money', 'checkout'],
      steps: {
        place: {
          title: 'Place the order',
          summary: '**Place order** saves the sale and prints the receipt.',
          steps: [
            'Tap **Place order** (for a table: **Update / Pay**).',
            'The **Complete Order** window opens.',
            'Type the **Customer Name**. Add the mobile number if you have it.',
            'To add a note, type it in **Order Notes**. It prints on the receipt and shows on the kitchen display.',
            'Pick the payment method.',
            'Tap **Place order**.',
          ],
          next: [
            'The order is saved and the receipt prints.',
            'A pickup or delivery order leaves the screen. Find it later in **Recent Orders**.',
            'The order shows on the kitchen display.',
            'When the till is online, the order is sent to the back office.',
            'If your till has a cash drawer set up, it opens for cash sales.',
          ],
          careful: [
            'Check the dishes and the total before you tap **Place order**.',
            'If something is missing, the window shows **Finish these before placing the order**. Tap **Show me** to go to it.',
          ],
          notes: ['Type the customer name.', 'Pick the payment method.', 'Tap **Place order**.'],
          keywords: ['place order', 'complete order', 'checkout', 'customer name', 'notes'],
        },
        cash: {
          title: 'Cash and change',
          summary: 'Some branches let you type the cash the customer gives. The till works out the change.',
          steps: [
            'Pick cash as the payment method.',
            'If you see **Cash received**, type the amount the customer gave you. Or tap **Exact**.',
            'Read the **Change**. Give it to the customer.',
            'Tap **Place order**.',
          ],
          next: ['The cash received and the change print on the receipt.'],
          careful: [
            'The amount must end in 0 or 5 fils. There are no 1 fils coins.',
            'If you type less than the total, it does not print. You see **Less than the total — will not be printed**.',
          ],
          notes: ['Type the cash the customer gave you.', 'Give this change back.'],
          keywords: ['cash', 'change', 'tender', 'money'],
        },
        knet: {
          title: 'KNET or card',
          summary: 'Place the order with KNET, take the card payment, then mark it paid.',
          steps: [
            'Pick KNET as the payment method. Tap **Place order**.',
            'Take the payment on the card machine.',
            'Wait for the card machine slip.',
            'In the side menu, tap **Recent Orders**.',
            'Find the order. Tap **Mark paid** on its row. (On a narrow screen it is a small icon with the same name.) For a table that is still open, you can tap **Mark paid** on the order instead.',
            'Check that **Paid by** shows KNET.',
            'Type the **KNET slip reference** from the slip.',
            'Tap **Mark paid**.',
          ],
          next: [
            'The order shows **Paid**, with KNET and your name.',
            'If the till is offline, it shows **Paid (waiting to send)**. It is sent later.',
          ],
          careful: [
            'Tap **Mark paid** only after the card machine says the payment went through.',
            'Copy the reference carefully. It is how the shop matches the slip later.',
            'Other cards work the same way. Only KNET asks for the reference.',
          ],
          notes: ['Check it says KNET.', 'Type the reference from the card machine slip.', 'Tap **Mark paid**.'],
          keywords: ['knet', 'card', 'visa', 'mark paid', 'slip', 'reference', 'machine'],
        },
        link: {
          title: 'Payment link (QR or WhatsApp)',
          summary: 'The customer pays on their own phone.',
          steps: [
            'Pick the online payment method. Tap **Place order**.',
            'The **Payment link** window opens with a QR code.',
            'Ask the customer to scan the QR code with their phone camera.',
            'Or tap **WhatsApp** to send the link to the customer’s mobile. Or tap **Copy link**.',
            'Tap **Check payment status** to see if they paid.',
          ],
          next: ['When the customer pays, the order shows **Paid**.'],
          careful: [
            'A payment link needs the internet.',
            '**WhatsApp** needs the customer’s mobile number.',
            'If you see **Payment failed**, ask the customer to try again, or use another method.',
            'If you see **The payment link has expired**, create a new link for the customer.',
          ],
          keywords: ['link', 'qr', 'whatsapp', 'online payment', 'myfatoorah'],
        },
        undo: {
          title: 'Undo a payment',
          summary: 'Take the paid mark off an order that was marked paid by mistake.',
          steps: [
            'In **Recent Orders**, find the order. Tap **View details**.',
            'Tap **Undo paid**.',
            'Type the reason.',
            'Tap **Undo paid**.',
            'If the **Manager approval** window opens, a manager types their code.',
          ],
          next: ['The order shows **Unpaid** again.'],
          careful: ['Only undo it if the payment really did not happen.'],
          keywords: ['undo', 'unpaid', 'mistake', 'remove payment'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    change: {
      title: 'Change or cancel',
      blurb: 'Change dishes, remove a sent dish, cancel an order.',
      keywords: ['void', 'cancel', 'remove', 'mistake', 'edit'],
      steps: {
        before: {
          title: 'Change an order before you place it',
          summary: 'Before **Place order**, you can change anything.',
          steps: [
            'Use **+**, **−** and the bin to change the dishes.',
            'To start again, tap **Clear cart**.',
            'To throw away an empty order, tap **Close order**.',
          ],
          next: ['An empty order is deleted when you close it. It does not show anywhere.'],
          careful: ['**Clear cart** removes every dish. You cannot undo it.'],
          keywords: ['clear cart', 'start again', 'delete order'],
        },
        sent: {
          title: 'Remove a dish that was already sent',
          summary: 'After a table’s order is placed, its dishes are locked. A manager must agree before you remove or reduce one.',
          steps: [
            'Tap **−** or the bin on the dish.',
            'The **Manager approval** window opens.',
            'Ask a manager to type their 6-digit code or scan their manager card.',
            'Pick a reason, for example **Wrong item**.',
            'Tap **Approve**.',
          ],
          next: [
            'The dish is taken off the order and off the kitchen display. The total goes down.',
            'The change is saved with the manager’s name.',
          ],
          careful: [
            'If you are allowed to do this yourself, the window does not open.',
            'A placed pickup or delivery order is not on the screen any more, so you cannot change it here. Tell your manager.',
          ],
          notes: ['The manager types their code here.', 'Pick a reason.', 'Tap **Approve**.'],
          keywords: ['void', 'remove sent', 'manager', 'approval', 'wrong item'],
        },
        cancel: {
          title: 'Cancel an order',
          summary: 'Only a manager can cancel a placed order.',
          steps: [
            'Tell your manager the order number.',
            'Your manager cancels it in **Today’s Orders**.',
          ],
          careful: [
            'Do not use **Close order** to cancel. **Close order** finishes the sale.',
          ],
          keywords: ['cancel', 'customer left', 'changed mind'],
        },
        'cancel-manager': {
          title: 'Cancel an order (managers)',
          summary: 'Cancel a placed order from Today’s Orders.',
          steps: [
            'In the side menu, tap **Recent Orders**.',
            'Find the order.',
            'Tap the status badge. In the menu, pick **Cancelled by customer**.',
            'If the till asks for **Manager approval**, type your code.',
          ],
          next: ['The order is cancelled. It shows under **Cancelled Orders** in the closing report.'],
          careful: [
            'A closed order cannot be cancelled.',
            'You cannot undo a cancel.',
          ],
          keywords: ['cancel', 'manager', 'status'],
        },
        approve: {
          title: 'Give manager approval',
          summary: 'Some changes need your code. Staff call you, you type it.',
          steps: [
            'Read the window. It says what the cashier wants to do, for example **Remove or reduce an item already sent to the kitchen**.',
            'Type your 6-digit **Approval code**, or scan your manager card.',
            'Pick or type a **Reason**.',
            'Tap **Approve**.',
          ],
          next: ['The change happens. Your name is saved with it.'],
          careful: ['Type the code yourself. Never tell it to staff.'],
          keywords: ['approval', 'code', 'manager card', 'approve'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    orders: {
      title: 'Today’s orders',
      blurb: 'Find an order, see its details, reprint it.',
      keywords: ['history', 'list', 'recent', 'website', 'online orders'],
      steps: {
        find: {
          title: 'Find an order',
          summary: 'All of today’s orders are in one list, one row for each order.',
          steps: [
            'In the side menu, tap **Recent Orders**.',
            'Type the order number, the name or the mobile in the search box. The list changes as you type.',
            'Use **Order type** to show one kind only. The tabs **Live**, **Done** and **Cancelled**, and **Paid** and **Unpaid**, work the same way.',
            'To see another day, tap the date button, pick the dates and tap **Filter**. The round arrow reads the list again.',
          ],
          next: ['Orders made on the website also show in this list.'],
          careful: ['Website orders are accepted in the back office, not on the till.'],
          notes: ['Search by number, name or mobile.', 'See the details.', 'Print the receipt again.'],
          keywords: ['search order', 'find', 'website'],
        },
        details: {
          title: 'See the details of an order',
          summary: 'See the dishes and what happened to the order.',
          steps: [
            'Find the order.',
            'Tap the row, or tap the eye button (**View details**).',
            'Read the dishes and the **History**.',
          ],
          next: ['Looking at an order does not change it.'],
          keywords: ['details', 'history', 'timeline'],
        },
        status: {
          title: 'Move an order to the next step',
          summary: 'Tell everyone where the order is.',
          steps: [
            'Find the order.',
            'Tap the button on its row: **Start preparing**, **Mark ready** or **Complete order**. For another step, such as **Waiting for pickup**, tap the status badge and pick it from the menu.',
          ],
          next: ['The order moves to that step.'],
          careful: [
            'You can only go forward. You cannot go back.',
            'An order that is still **Open** (not placed yet) has no status buttons.',
          ],
          keywords: ['status', 'ready', 'prepared', 'closed'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    kitchen: {
      title: 'Kitchen display',
      blurb: 'Read new orders and mark them ready.',
      keywords: ['kitchen', 'chef', 'cook', 'screen'],
      steps: {
        read: {
          title: 'Read the kitchen screen',
          summary: 'Orders move from left to right as they are cooked.',
          steps: [
            'In the side menu, tap **Kitchen display**.',
            'New orders are under **New orders**. Orders being cooked are under **Preparing**. Finished orders are under **Ready**.',
            'Each card shows the order number, the kind of order and the table.',
            'Read the dishes. The number in the blue box is how many.',
            'Read the yellow box. It is the note the cashier typed for this order.',
          ],
          next: [
            'The screen updates by itself every 15 seconds.',
            'Tap **Refresh** to update it now.',
          ],
          careful: [
            'The time on a card turns orange after 10 minutes and red after 20 minutes.',
          ],
          notes: ['New orders come in here.', 'Tap when you start cooking.'],
          keywords: ['ticket', 'new orders', 'preparing', 'ready', 'time'],
        },
        move: {
          title: 'Move an order along',
          summary: 'One tap moves the order to the next column.',
          steps: [
            'Tap **Start preparing** when you start cooking.',
            'Tap **Mark ready** when the food is ready.',
            'Tap **Complete order** when the food is handed over.',
          ],
          next: [
            'The card moves to the next column.',
            '**Complete order** closes the order and takes it off the screen.',
          ],
          careful: ['Each tap moves the order forward. You cannot move it back here.'],
          keywords: ['start preparing', 'mark ready', 'complete order', 'done'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    printing: {
      title: 'Printing and the cash drawer',
      blurb: 'When the receipt prints, reprints, printer and drawer setup.',
      keywords: ['print', 'printer', 'receipt', 'drawer', 'paper'],
      steps: {
        when: {
          title: 'When the receipt prints',
          summary: 'The till prints one receipt for the order. The kitchen uses the kitchen display.',
          steps: [
            'When you tap **Place order**.',
            'When you send more dishes to a table with **Update / Pay**.',
            'When you tap **Close & Release** on a table.',
            'When you tap **Close order**, if the order was never printed.',
          ],
          next: [
            'If the printer fails, a message shows with **Try again**. The sale is still saved.',
          ],
          careful: [
            'If a receipt does not come out, do not place the order again. Reprint it instead.',
          ],
          keywords: ['receipt', 'print', 'when'],
        },
        reprint: {
          title: 'Reprint a receipt',
          summary: 'Print a receipt again from the orders list.',
          steps: [
            'In the side menu, tap **Recent Orders**.',
            'Find the order.',
            'Tap the printer button (**Print receipt**).',
          ],
          next: [
            'Only paper comes out. The order does not change.',
            'The cash drawer does not open for a reprint.',
          ],
          keywords: ['reprint', 'copy', 'print again'],
        },
        'setup-printer': {
          title: 'Set up the receipt printer',
          summary: 'Pick the printer and paper size. Saved on this till only.',
          steps: [
            'In the side menu, tap **Settings**.',
            'Under **Receipt printer**, pick the printer in **Printer**.',
            'Pick the **Paper width**.',
            'Tap **Print a test receipt**.',
          ],
          next: [
            'Each change is saved straight away. You see **Printer settings saved.**',
            'The settings are kept on this till only.',
          ],
          careful: [
            'Keep **Show the print dialog** off. Turn it on only if receipts do not come out.',
            'Keep **Paper height** at 0 for roll paper.',
          ],
          keywords: ['printer setup', 'paper width', 'print dialog', 'settings'],
        },
        drawer: {
          title: 'Set up the cash drawer',
          summary: 'The drawer plugs into the receipt printer. It is off until you turn it on.',
          steps: [
            'Pick the receipt printer first. The drawer opens through it.',
            'Under **Cash drawer**, turn on **Open the drawer when an order is placed**.',
            'Keep **Cash payments only** on.',
            'Tap **Open the drawer now** to test it.',
          ],
          next: [
            'The drawer opens after the receipt prints, and only the first time an order prints.',
            'It never opens for a reprint.',
          ],
          careful: [
            'Test with **Open the drawer now** before you use it in the shop. It needs a thermal receipt printer. On the wrong printer, it can print a slip of strange letters instead.',
            'If the test does nothing but the printer works, change **Drawer connection** to **Alternative**. Test again.',
          ],
          keywords: ['cash drawer', 'drawer', 'open drawer'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    offline: {
      title: 'No internet',
      blurb: 'What works offline and how orders are sent later.',
      keywords: ['offline', 'internet', 'sync', 'connection', 'wifi'],
      steps: {
        works: {
          title: 'No internet: keep selling',
          summary: 'The till keeps working without the internet. Keep selling as normal.',
          steps: [
            'Keep taking orders as normal.',
            'Do not change the **Mode** on the sign-in screen.',
            'When the internet comes back, the till sends the orders by itself.',
          ],
          next: [
            'Orders, receipts and **Mark paid** are saved on the till. They are sent to the back office later.',
            'You can switch the till off. The orders are kept and sent later.',
          ],
          careful: [
            'These wait until the internet is back: payment links, new website orders and menu changes.',
          ],
          keywords: ['offline', 'no internet', 'keep selling'],
        },
        waiting: {
          title: 'See orders waiting to send',
          summary: 'The sign-in screen shows how many orders are not sent yet.',
          steps: [
            'Go to the sign-in screen.',
            'Under **Device status**, read **Outbox**.',
            '**Up to date** means everything is sent. **3 pending** means 3 orders are waiting.',
          ],
          keywords: ['outbox', 'pending', 'waiting', 'unsent'],
        },
        'send-now': {
          title: 'Send orders now',
          summary: 'You do not have to wait. You can send them now.',
          steps: [
            'If the side menu shows only icons, tap **Expand sidebar** to open it.',
            'At the top of the side menu, tap the round arrow button next to the branch name.',
            'Wait a moment. The time changes to **just now**.',
          ],
          careful: [
            'If the sign says **Offline**, the button does not work. Keep selling. The till sends the orders when it is back online.',
            'If you see **Sync failed**, the internet or the server is down. Keep selling. Try again later.',
          ],
          keywords: ['sync now', 'send', 'refresh'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    closing: {
      title: 'End of the day',
      blurb: 'Read and print the closing report.',
      keywords: ['closing', 'report', 'end of day', 'total', 'z report'],
      steps: {
        read: {
          title: 'Read the closing report',
          summary: 'See what was sold today.',
          steps: [
            'In the side menu, tap **Closing Report**.',
            'Read **Total Earning** and the other boxes at the top.',
            'Use the tabs to see more: **By Item**, **By Category**, **By Payment**, **By Order Type**.',
          ],
          next: ['The report shows the current working day. Looking at it does not change anything.'],
          careful: [
            'Orders that were started but never placed are not counted. They show **Not counted — not put through**.',
          ],
          keywords: ['total earning', 'sales', 'by item', 'by payment'],
        },
        print: {
          title: 'Print the closing report',
          summary: 'At the end of your work, print the report, sign it and give it to your manager.',
          steps: [
            'Open **Closing Report**.',
            'Tap **Print Thermal**.',
            'Check the slip. Sign it at **Cashier signature**.',
            'Give the slip to your manager.',
          ],
          next: ['The report prints on the receipt printer. Printing does not change any order.'],
          careful: [
            'Print it after the last order is closed.',
            '**Print** (not thermal) opens a big page for an office printer.',
          ],
          notes: ['What the branch sold today.', 'Print the slip to sign.'],
          keywords: ['print report', 'thermal', 'signature', 'closing slip'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    manager: {
      title: 'Manager tools',
      blurb: 'Language, tables, updates, permissions and more.',
      keywords: ['manager', 'admin', 'settings'],
      steps: {
        language: {
          title: 'Change the language',
          summary: 'The till works in English and Arabic.',
          steps: ['At the bottom of the side menu, tap **English** or **العربية**.'],
          next: ['The screen changes language and direction. The choice is saved on this till.'],
          keywords: ['language', 'arabic', 'english'],
        },
        'text-size': {
          title: 'Make the text bigger',
          summary: 'Change the text size on this till.',
          steps: [
            'In the side menu, tap **Settings**.',
            'Under **Text size**, pick **Small**, **Normal**, **Large** or **Extra large**.',
          ],
          next: ['Only the text changes. Buttons and layout stay the same.'],
          keywords: ['text size', 'font', 'bigger'],
        },
        'clear-table': {
          title: 'Clear a table',
          summary: 'Free a table that is still marked as taken.',
          steps: [
            'In the side menu, tap **Tables**.',
            'Find the table.',
            'Tap **Clear table**. Confirm.',
          ],
          next: ['The order is taken off the table. The table is free.'],
          careful: [
            'A table that still has an open order needs a manager code.',
          ],
          keywords: ['clear table', 'stuck table', 'free table'],
        },
        update: {
          title: 'Install an update',
          summary: 'The till gets new versions by itself. You choose when to install.',
          steps: [
            'When you see **Update ready** in the side menu, tap it.',
            'Make sure no order is open.',
            'Tap **Restart and install now**.',
          ],
          next: [
            'The app closes and opens again on the new version.',
            'If you do not install it, it installs the next time the till is closed.',
          ],
          careful: [
            'Do it at a quiet time, with no open orders.',
            'Do not turn off the computer while it installs.',
          ],
          keywords: ['update', 'new version', 'install', 'restart'],
        },
        permissions: {
          title: 'Role permissions',
          summary: 'Choose what each job can do.',
          steps: [
            'In the side menu, tap **Permissions**.',
            'Pick a role in **Select role**.',
            'Turn each permission on or off.',
            'Tap **Save changes**.',
          ],
          next: ['Every user with that role gets the change.'],
          careful: [
            'Read the note at the top of the screen. It says if the change is for this till only or comes from the back office.',
            'You cannot change your own role here.',
          ],
          keywords: ['permissions', 'roles', 'access', 'rights'],
        },
        lists: {
          title: 'Menu, prices, payment methods and areas',
          summary: 'These lists come from the back office. The till only shows them.',
          steps: [
            'Change the menu, prices, promo codes, payment methods or delivery areas in the back office.',
            'On the till, tap the round arrow button next to the branch name to get the change.',
          ],
          next: ['The new menu shows on the till after it gets the change.'],
          keywords: ['menu', 'price', 'items', 'categories', 'locations', 'payment methods'],
        },
        repair: {
          title: 'Repair incomplete orders',
          summary: 'Use this if the closing report shows **Unknown** or the **By Item** tab is empty.',
          steps: [
            'In the side menu, tap **Settings**.',
            'Find **Repair incomplete orders**.',
            'Tap **Repair from server**.',
            'Read the result.',
          ],
          next: ['The till asks the server for what is missing on those orders only.'],
          careful: ['It is safe to run at any time, and safe to run again.'],
          keywords: ['repair', 'unknown', 'missing items'],
        },
        unpair: {
          title: 'Unpair a till',
          summary: 'Disconnect a till from the branch, for example to move it.',
          steps: [
            'Sign out. You are on the sign-in screen.',
            'Tap **Unpair device**.',
            'Choose if you also want **Also delete all data on this device**.',
            'Tap **Yes, unpair**.',
          ],
          next: [
            'The till is no longer connected to the branch.',
            'To use it again, connect it with a new code.',
          ],
          careful: [
            'Send all orders first. If the window says some orders are not sent yet, they will not reach the back office.',
            'If you are not sure, tap **Keep paired**.',
          ],
          keywords: ['unpair', 'reset', 'move till', 'disconnect'],
        },
      },
    },

    /* ------------------------------------------------------------------ */
    trouble: {
      title: 'Something went wrong',
      blurb: 'Simple checks for common problems.',
      keywords: ['problem', 'error', 'not working', 'help', 'broken'],
      steps: {
        printer: {
          title: 'Printer not printing',
          summary: 'The receipt does not come out.',
          steps: [
            'Check the printer is on and has paper.',
            'Check the cable is plugged in.',
            'If a message showed, tap **Try again**.',
            'Reprint it from **Recent Orders** with the printer button.',
            'Manager: in **Settings**, tap **Print a test receipt**.',
            'Manager: if nothing comes out, turn on **Show the print dialog** and test again.',
          ],
          careful: ['Do not place the order again. It is already saved.'],
          keywords: ['printer', 'no receipt', 'paper', 'not printing'],
        },
        offline: {
          title: 'Till shows offline or orders are not sending',
          summary: 'The side menu says **Offline**, or the last-sent time keeps getting older.',
          steps: [
            'Keep selling. Orders are saved on the till and sent later.',
            'Check the internet cable or the Wi-Fi.',
            'When the sign says **Online** again, tap the round arrow button next to the branch name.',
            'If you see **Sync failed**, wait a few minutes and try again.',
            'If it stays **Offline** while the internet works, ask your manager to check that **Mode** is **Live (sync)** on the sign-in screen.',
          ],
          keywords: ['offline', 'sync failed', 'not sending', 'internet'],
        },
        'missing-order': {
          title: 'An order is missing on another till',
          summary: 'An order taken on one till does not show on another.',
          steps: [
            'On the till that took the order, tap the round arrow button next to the branch name.',
            'Wait a minute. Then tap the same button on this till.',
            'Look for the order in **Recent Orders**.',
          ],
          keywords: ['missing', 'other till', 'not showing', 'stuck'],
        },
        menu: {
          title: 'A dish or price is wrong or missing',
          summary: 'The menu comes from the back office. The till cannot change it.',
          steps: [
            'Tell your manager which dish is wrong.',
            'Your manager fixes it in the back office.',
            'Then tap the round arrow button next to the branch name.',
          ],
          keywords: ['price', 'wrong price', 'missing dish', 'menu'],
        },
        payment: {
          title: 'Payment failed or the customer paid twice',
          summary: 'The money did not go through, or went through twice.',
          steps: [
            'Payment link: tap **Check payment status**.',
            'If you see **Payment failed**, ask the customer to try again, or use another method.',
            'If the link expired, create a new link for the customer.',
            'Card machine said no: do not tap **Mark paid**. Ask for another card or cash.',
            'Customer paid twice: do not give money back from the till yourself. Tell your manager.',
          ],
          keywords: ['payment failed', 'declined', 'paid twice', 'refund'],
        },
        drawer: {
          title: 'Cash drawer will not open',
          summary: 'The drawer stays shut after a cash sale.',
          steps: [
            'The drawer opens only for a new sale, after the receipt prints. It does not open for a reprint.',
            'If **Cash payments only** is on, it opens only for cash.',
            'Check the drawer cable is plugged into the receipt printer.',
            'Manager: in **Settings**, tap **Open the drawer now**.',
            'Manager: if nothing happens, change **Drawer connection** to **Alternative** and test again.',
          ],
          careful: ['The drawer is off until a manager turns it on in **Settings**.'],
          keywords: ['drawer', 'cash drawer', 'will not open'],
        },
        'sign-in': {
          title: 'Cannot sign in, or the till asks to pair again',
          summary: 'The password does not work, or you see the pairing screen.',
          steps: [
            'Tap your name under **Quick users** again. Type the password slowly.',
            'If you see **Caps Lock is ON**, press the Caps Lock key once.',
            'Staff can only sign in at their own branch.',
            'If there are no names (**No users synced yet**), ask your manager.',
            'If the till shows the pairing screen, it must be connected again. Your manager needs a new code from the back office.',
            'If it says **This device was locked by the server**, ask your manager. The orders on the till are safe.',
          ],
          keywords: ['password', 'login', 'pair again', 'locked', 'cannot sign in'],
        },
      },
    },
  },
};
