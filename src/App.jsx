import { MessageCircle, Plus, QrCode, Folder, FolderOpen, Archive, RotateCcw, Upload, Users, Paperclip, Play, Pause, Square, Save, Download, Minus, Maximize2, X, Send, ShieldCheck } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './components/ui/card';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { NativeSelect } from './components/ui/native-select';

function Panel({ title, description, children }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>;
}
function Field({ id, label, children }) {
  return <div className="space-y-2"><label htmlFor={id} className="text-xs font-medium">{label}</label>{children}</div>;
}
function Check({ id, children, defaultChecked = false }) {
  return <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" htmlFor={id}><input id={id} type="checkbox" defaultChecked={defaultChecked} className="mt-1 size-3.5 accent-emerald-700" />{children}</label>;
}
function Action({ id, icon: Icon, children, variant = 'outline', ...props }) {
  return <Button id={id} variant={variant} size="sm" {...props}>{Icon && <Icon />}{children}</Button>;
}

// Mount once: uncontrolled fields and empty list containers are owned by the
// existing desktop controller. React does not reconcile those mutable children.
export default function App() {
  return <div className="window-shell">
    <header className="titlebar">
      <div className="flex items-center gap-2 text-xs font-semibold"><MessageCircle className="size-4 text-emerald-700" />Campaign Console</div>
      <div className="titlebar-controls">
        <Button id="windowMinBtn" variant="ghost" size="icon" title="Minimize" aria-label="Minimize"><Minus /></Button>
        <Button id="windowMaxBtn" variant="ghost" size="icon" title="Maximize" aria-label="Maximize"><Maximize2 /></Button>
        <Button id="windowCloseBtn" variant="ghost" size="icon" className="hover:bg-red-100 hover:text-red-700" title="Close" aria-label="Close"><X /></Button>
      </div>
    </header>
    <main className="window-content">
      <div className="mx-auto max-w-7xl px-6 py-7">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div><div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Messaging workspace</div><h1 className="text-2xl font-semibold tracking-tight">WhatsApp campaigns</h1><p className="mt-1 text-sm text-muted-foreground">Connect your accounts. Prepare your audience. Stay in control.</p></div>
          <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-emerald-700" />Local workspace</span>
        </div>
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Send only to recipients who opted in. This is unofficial WhatsApp automation; delays do not guarantee protection from account restrictions.</div>
        <div className="workspace-grid">
          <aside className="space-y-5">
            <Panel title="Accounts" description="Each session connects a separate WhatsApp account.">
              <div className="flex gap-2"><Input id="sessionNameInput" aria-label="Session name" placeholder="e.g. Customer support" /><Action id="addSessionBtn" icon={Plus} variant="default">Add</Action></div>
              <div id="sessionsList" className="list" aria-live="polite" />
            </Panel>
            <Panel title="Connect WhatsApp" description="On your phone, open Linked devices and scan the QR code.">
              <Check id="showBrowserOnConnect">Show WhatsApp browser window</Check>
              <div className="flex gap-2"><NativeSelect id="authSessionSelect" aria-label="Account to connect" /><Action id="connectSessionBtn" icon={QrCode} variant="default">Connect</Action></div>
              <div id="authStatus" role="status" className="status-box">Select an account to connect.</div>
              <div id="qrCode" className="qr-wrap">Your QR code will appear here</div>
            </Panel>
            <Panel title="Send routing" description="Use one account or a selected pool of connected sessions.">
              <Field id="sendMode" label="Mode"><NativeSelect id="sendMode" defaultValue="single"><option value="single">Single session</option><option value="pool">Session pool</option></NativeSelect></Field>
              <Field id="singleSessionSelect" label="Sending account"><NativeSelect id="singleSessionSelect" /></Field>
              <div className="space-y-2"><label htmlFor="poolSessions" className="text-xs font-medium">Pool accounts</label><div id="poolSessions" className="list" /></div>
            </Panel>
            <Panel title="Storage & backups" description="Login credentials and campaigns stay in your chosen folder.">
              <p id="storagePathLabel" className="hint break-all">Loading storage…</p>
              <div className="flex flex-wrap gap-2"><Action id="chooseStorageFolderBtn" icon={Folder}>Choose folder</Action><Action id="openStorageFolderBtn" icon={FolderOpen}>Open</Action><Action id="createBackupBtn" icon={Archive}>Backup</Action><Action id="restoreBackupBtn" icon={RotateCcw}>Restore</Action></div>
            </Panel>
          </aside>
          <div className="space-y-5 min-w-0">
            <Panel title="01 · Audience" description="Import a spreadsheet or paste phone numbers, including country codes.">
              <div className="grid grid-cols-2 gap-4"><Field id="campaignName" label="Campaign name"><Input id="campaignName" placeholder="Customer follow-up" /></Field><Field id="defaultCountryCode" label="Default country code"><Input id="defaultCountryCode" defaultValue="91" placeholder="91" /></Field></div>
              <div className="flex flex-wrap items-center gap-3"><Action id="selectFile" icon={Upload}>Import spreadsheet</Action><span id="selectedFile" className="hint">No file selected</span></div>
              <div className="grid grid-cols-2 items-end gap-4"><Field id="phoneColumnSelect" label="Phone number column"><NativeSelect id="phoneColumnSelect" /></Field><Action id="loadExcelContactsBtn" icon={Users}>Load contacts</Action></div>
              <Field id="manualNumbers" label="Manual phone numbers"><Textarea id="manualNumbers" placeholder={'+919999999999\n+919898989898'} /></Field>
              <div className="flex flex-wrap items-center justify-between gap-3"><Check id="appendManualCheckbox">Append to current contacts</Check><Action id="loadManualContactsBtn" icon={Plus}>Add numbers</Action></div>
              <div className="status-box"><div id="contactsSummary">No contacts loaded.</div><div id="excelPreview" className="hint" /><div id="invalidDetails" className="hint" /></div>
              <div id="contactsPreview" className="list" />
            </Panel>
            <Panel title="02 · Message" description="Write a personal message and optionally attach a photo, video or document.">
              <Field id="messageText" label="Message / caption"><Textarea id="messageText" className="min-h-36" placeholder="Hi ${name}, your order is ready." /></Field>
              <Check id="enableNamePersonalization">Enable placeholder personalization</Check>
              <p className="hint">Use {'${name}'} for the recipient name or {'${ColumnName}'} for imported fields.</p>
              <div className="flex flex-wrap items-center gap-3"><Action id="selectMedia" icon={Paperclip}>Attach media</Action><span id="selectedMedia" className="hint">No attachment</span><Action id="removeMediaBtn">Remove</Action></div>
              <div className="border-t pt-4">
                <div className="mb-4 flex gap-2"><Action id="modeDelayBtn">Set by delay</Action><Action id="modeSpeedBtn">Set by speed</Action></div>
                <div id="delayModePane" className="grid grid-cols-2 gap-4 mode-pane"><Field id="minDelay" label="Minimum delay (seconds)"><Input id="minDelay" type="number" min="1" defaultValue="6" /></Field><Field id="maxDelay" label="Maximum delay (seconds)"><Input id="maxDelay" type="number" min="1" defaultValue="12" /></Field></div>
                <div id="speedModePane" className="grid grid-cols-2 gap-4 mode-pane hidden"><Field id="maxPerMinute" label="Maximum per minute"><Input id="maxPerMinute" type="number" min="1" placeholder="e.g. 6" /></Field><Field id="maxPerHour" label="Maximum per hour"><Input id="maxPerHour" type="number" min="1" placeholder="e.g. 180" /></Field></div>
                <div id="throughputBox" className="throughput-box"><div id="throughputSummary" /><div id="throughputUpperLimit" className="hint" /><div id="throughputWarning" className="hint" /></div>
              </div>
              <Check id="enforceSendWindow" defaultChecked>Send only between 09:00 and 20:00 (computer local time)</Check>
              <div className="flex flex-wrap gap-2 border-t pt-4"><Action id="startSending" icon={Send} variant="default">Start campaign</Action><Action id="pauseSending" icon={Pause} disabled>Pause</Action><Action id="resumeSending" icon={Play} disabled>Resume</Action><Action id="stopSending" icon={Square} variant="destructive" disabled>Stop</Action></div>
              <div className="progress" role="progressbar" aria-label="Campaign progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progressBarFill" /></div><div id="progressText" className="hint">0/0 messages sent</div>
              <div className="flex flex-wrap gap-2"><Action id="saveDraftBtn" icon={Save}>Save draft</Action><Action id="loadDraftBtn" icon={FolderOpen}>Load draft</Action><Action id="downloadReport" icon={Download} disabled>Export report</Action></div>
            </Panel>
            <Panel title="03 · Campaign history" description="Review results or load a previous campaign."><div id="campaignsList" className="list" /></Panel>
          </div>
        </div>
      </div>
    </main>
    <dialog id="renameSessionDialog" className="rounded-xl border bg-card p-6 text-card-foreground shadow-xl"><h2 className="mb-4 font-semibold">Rename account</h2><Input id="renameSessionInput" aria-label="New session name" maxLength="40" /><div className="mt-4 flex justify-end gap-2"><Action id="renameCancelBtn">Cancel</Action><Action id="renameSaveBtn" variant="default">Save</Action></div></dialog>
    <div id="snackbar" className="snackbar" role="status" aria-live="polite" />
  </div>;
}
