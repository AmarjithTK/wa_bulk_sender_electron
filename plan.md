# WhatsApp Bulk Sender - Material You Redesign & Feature Plan

## 1. Material You (MD3) UI Architecture
The UI will be strictly completely rewritten using Google's **Material Web Components (`@material/web`)** to adopt Material Design 3 (Material You) principles.

### Layout
*   **Navigation Rail (Left)**: Icon-based collapsible sidebar for switching between views.
    *   *Dashboard* (Connection status, stats)
    *   *Campaigns* (Message composition, media attachments, sending progress)
    *   *Contacts* (List management, Excel import)
    *   *Settings* (Anti-ban delays, session management)
*   **Top App Bar**: Contextual title for the current view and global actions (e.g., Theme toggle).
*   **Main Content Area**: Floating cards (`Surface` containers with elevation) to group related content with rounded corners (MD3 styling).

### Color & Typography
*   **Color System**: Modern color palette utilizing MD3 tonal palettes (Primary, Secondary, Tertiary, Surface, Error variants). Support for Light/Dark mode toggle.
*   **Typography**: Clean use of MD3 Text Styles (Headline for headers, Title for cards, Body for content, Label for UI elements) utilizing the "Roboto" font.

---

## 2. Multitude of Bulk Sender Features

### Core & Connection Management
*   **Multi-Account Management**: Connect, authenticate, and manage multiple WhatsApp accounts simultaneously. Keep track of persistent sessions for each account independently.
*   **Visual Status Indicators**: Clear MD3 Cards showing the state of *each* account, interactive QR Code displays for pairing new accounts, and selective session logouts.

### Multi-Account Rotation (Load Balancing)
*   **Sender Rotation**: Distribute the sending load across all active accounts (e.g., Account A sends to Contact 1, Account B to Contact 2) to drastically reduce the ban risk for any single number.
*   **Dynamic Fallback**: If an account disconnects or fails during a campaign, automatically pause that account and redistribute its queue to the remaining active accounts.
*   **Account Limits**: Set maximum sending limits per account per campaign.

### Contact Management
*   **Excel/CSV Import**: Import contact lists with dynamic columns mapping (Name, Number, Custom Variable 1, Custom Variable 2).
*   **Valid Number Filtering**: Pre-flight checks to format and validate numbers (appending country codes).
*   **Contact Table View**: Material Data Table displaying loaded contacts with the ability to manually remove specific rows.

### Messaging & Campaigns
*   **Dynamic Variables**: Support for `{name}` or `{var1}` in the message text, which replaces placeholders with Excel column data.
*   **Multi-Media Support**: Attach Images, PDFs, and Videos directly into the campaign.
*   **Message Preview**: A simulated WhatsApp-style chat bubble previewing how the message will look to the first contact.

### Anti-Ban & Delivery Control
*   **Randomized Delays**: Specify a time range (e.g., *between 5 to 15 seconds*) between each message to mimic human behavior.
*   **Batch Sending (Sleep Mode)**: Pause sending for `X` minutes after every `Y` messages.
*   **Action Controls**: Play, Pause, Resume, and Stop controls for an active campaign.

### Reporting & Analytics
*   **Live Progress**: Real-time sending metrics (Total, Successful, Failed, Pending) with an `<md-linear-progress>` bar.
*   **Detailed Logs**: A scrollable log window showing the real-time status of each sent message.
*   **Export Report**: Export the success/failure results to a PDF or Excel file after the campaign ends.

---

## 3. Implementation Phases

**Phase 1: Foundation & Layout Redesign**
*   Wipe the current `index.html` structure.
*   Setup standard `@material/web` elements, Roboto font, and Material Icons.
*   Build the shell: Navigation Rail, App Bar, main routing logic (vanilla JS tab switching).

**Phase 2: Authentication & Dashboard View**
*   Build the Dashboard view.
*   Integrate the existing `whatsapp-web.js` QR and Auth logic cleanly into the MD3 Cards.

**Phase 3: Contacts & Compose Views**
*   Build the Excel upload UI area and table viewer.
*   Build the message text area, dynamic variables inserter, and media attachment logic.

**Phase 4: Sending Engine, Rotation & Anti-ban**
*   Rewrite the sending loop to support multi-account rotation and dynamic fallback.
*   Implement randomized delays and batch sleep logic to act as humanly as possible.
*   Add Real-time progress bars and per-account log outputs.

**Phase 5: Polish & Export**
*   Dark/Light mode integration.
*   Campaign export (PDF/Excel) implementation.
