# POS App

A Windows point of sale app for restaurants, built with Electron, React and TypeScript.
It keeps selling when the internet drops: orders are saved on the device in SQLite and
sync with the restaurant's server when the connection comes back.

## What it does

- **Take orders fast:** item catalogue with categories, add ons and options, quantity
  controls, barcode scanning, dine in, takeaway and delivery with delivery fees
- **Tables:** table picker and a quick bar for dine in service
- **Payments:** cash with a cash drawer, card, and payment links sent to the customer
- **Kitchen:** a kitchen display screen and order printing on thermal printers
- **Offline first:** orders and the menu are stored locally and synced in the background
- **Reports:** closing report printed on the receipt printer, recent orders with a full timeline
- **Staff permissions:** each user only sees what their role allows, synced from the server
- **Secure pairing:** each till pairs with its branch once and keeps its credentials encrypted
- **Arabic and English,** switchable at any time, with right to left layouts
- **Updates itself** in the background

## Built with

Electron · React · TypeScript · Vite · SQLite (better-sqlite3) · Tailwind CSS · HeroUI ·
Zustand · i18next · electron-builder · electron-updater · Vitest

## Run it locally

```bash
npm install
npm run dev
```

## Test

```bash
npm run test:run    # unit tests
npm run typecheck   # TypeScript checks
```

## Build the Windows installer

```bash
npm run dist            # installer
npm run dist:portable   # single portable .exe
```

## Project layout

| Folder | What lives there |
|---|---|
| `src/main` | Electron main process: database, sync, printing, payments, updates |
| `src/renderer` | The React app: POS screen, kitchen display, reports, settings |
| `src/shared` | Types and helpers used by both sides |
| `docs` | Notes on the server API, pairing and permission sync |
