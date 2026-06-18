# Profiroll MMS — Maintenance Management System

A browser-based maintenance management system for logging machines, breakdowns, spare parts, KPIs, and monthly reports. All data is stored locally in CSV files on your file system.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (bundled with Node.js)

---

## Folder / Data Path Setup

The app reads and writes CSV data files relative to the path set in **`config.json`**:

```json
{
  "dataPath": "data"
}
```

This means the app expects a `data/` folder in the project root. **Create it before running the app for the first time:**

```
mkdir data
```

The app will auto-create the individual CSV files (`machines.csv`, `breakdowns.csv`, `spareparts.csv`, etc.) inside that folder on first use.

If you want to store data somewhere else (e.g. a shared network drive), change `"dataPath"` in `config.json` to the desired absolute or relative path:

```json
{
  "dataPath": "C:/Shared/ProfirollData"
}
```

---

## Installation

Clone or download the project, then install dependencies:

```bash
npm install
```

---

## Running the App (Development)

```bash
npm run dev
```

Opens the app at `http://localhost:3000` with live reload. Any file change reflects instantly in the browser.

---

## Building for Production

```bash
npm run build
```

Outputs a minified, self-contained bundle to the `dist/` folder. Copy the entire `dist/` folder to any static web server (Nginx, Apache, IIS, Netlify, GitHub Pages, etc.).

To preview the production build locally before deploying:

```bash
npm run preview
```

---

## Running Tests

```bash
npm test
```

---

## First-Time Usage — Important Order

> **Machines must be added before breakdowns can be logged.**

Follow this order when setting up the system for the first time:

### Step 1 — Add Machines
1. Open the app and navigate to **Machines** in the sidebar.
2. Click **＋ Add Machine** and fill in the machine details (name, type, location, status).
3. Save. Repeat for all machines on your plant floor.

### Step 2 — Add Spare Parts (optional but recommended)
1. Navigate to **Spare Parts** in the sidebar.
2. Click **＋ Add Part** and fill in part details, current stock, and minimum stock level.
3. Linking parts to machines allows the breakdown form to suggest relevant parts automatically.

### Step 3 — Log Breakdowns
1. Navigate to **Breakdowns** in the sidebar.
2. Click **＋ Log Breakdown**.
3. Select the machine from the dropdown (populated from the machines you added in Step 1).
4. Fill in date/time, technician, fault description, and spare parts used.
5. Save.

> If no machines have been added yet, the "Log Breakdown" button will show a warning and block the form from opening.

### Step 4 — Monitor KPIs and Reports
- **KPI** page shows MTTR and MTBF calculated automatically from breakdown data.
- **Monthly Reports** page generates per-machine summaries for any selected month/year.

---

## Project Structure

```
Profiroll/
├── data/                   # Auto-created — stores all CSV data files
├── dist/                   # Production build output (after npm run build)
├── tests/                  # Unit tests
├── index.html              # Dashboard
├── machines.html           # Machine registry
├── breakdowns.html         # Breakdown logging & history
├── spareparts.html         # Spare parts inventory
├── kpi.html                # MTTR / MTBF KPI dashboard
├── reports.html            # Monthly reports
├── documents.html          # Document storage
├── config.json             # App configuration (dataPath, machine types, etc.)
├── csv-store.js            # CSV read/write layer
├── config-loader.js        # Loads config.json at runtime
├── io-adapter.js           # File I/O abstraction
├── vite.config.js          # Vite bundler config
└── package.json
```

---

## Configuration Reference (`config.json`)

| Key | Description |
|-----|-------------|
| `dataPath` | Folder where CSV data files are stored. Relative to project root or absolute. |
| `appTitle` | Application title shown in the browser tab. |
| `defaultOperatingHours` | Monthly operating hours used for MTBF calculation (default: 720). |
| `lockTimeoutSeconds` | File lock timeout in seconds to prevent concurrent write conflicts. |
| `machineTypes` | List of machine type options shown in the machine form dropdown. |
| `machineLocations` | List of location options for the machine form. |
| `machineStatuses` | Allowed machine status values. |
| `sparePartCategories` | Spare part category options. |
| `breakdownStatuses` | Allowed breakdown status values (Open / In Progress / Closed). |
