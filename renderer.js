const { ipcRenderer } = require('electron');
const puppeteerPath = require('puppeteer').executablePath();


const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const xlsx = require('xlsx');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');
const getUserDataPath = () => {
    const userDataPath = process.env.APPDATA || 
        (process.platform == 'darwin' ? 
            path.join(process.env.HOME, 'Library', 'Application Support') : 
            path.join(process.env.HOME, '.local', 'share'));
    return path.join(userDataPath, 'whatsapp-bulk-sender');
};

const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Update sessionPath definition
const sessionPath = path.join(getUserDataPath(), 'whatsapp-session');
ensureDirectoryExists(sessionPath);

let client;
let selectedFilePath;
let selectedImagePath;
let isSending = false;
let totalMessages = 0;
let sentMessages = 0;
let messageResults = [];

console.log('hellow rold')

function showSnackbar(message, duration = 3000) {
    const snackbar = document.getElementById('snackbar');
    snackbar.textContent = message;
    snackbar.style.display = 'block';
    setTimeout(() => {
        snackbar.style.display = 'none';
    }, duration);
}

function updateAuthStatus(message, status) {
    const authStatus = document.getElementById('authStatus');
    const authIcon = document.getElementById('authIcon');
    
    authStatus.textContent = message;
    
    switch(status) {
        case 'pending':
            authIcon.textContent = 'phone_iphone';
            authStatus.parentElement.style.backgroundColor = '#fff3e0';
            break;
        case 'success':
            authIcon.textContent = 'check_circle';
            authStatus.parentElement.style.backgroundColor = '#e8f5e9';
            break;
        case 'error':
            authIcon.textContent = 'error';
            authStatus.parentElement.style.backgroundColor = '#ffebee';
            break;
    }
}

function initializeWhatsApp() {
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: sessionPath, // Use this session path to store the auth data
            clientId: "client-one"
        }),
        puppeteer: {

            executablePath:puppeteerPath,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            // userDataDir: null, 
            // userDataDir: './user-data',
        }
    });

    console.log(client)

    ipcRenderer.send('log-message', 'This is a message from the renderer process ' +client);


    client.on('qr', async (qr) => {
        console.log('Authenticated!');

        try {
            const qrContainer = document.getElementById('qrCode');
            const qrImage = await QRCode.toDataURL(qr, {
                width: 256,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            qrContainer.innerHTML = `<img src="${qrImage}" alt="QR Code">`;
            updateAuthStatus('Scan QR code with WhatsApp', 'pending');
        } catch (err) {
            console.error('QR Code generation failed:', err);
            updateAuthStatus('QR Code generation failed', 'error');
        }
    });

    client.on('authenticated', () => {
        console.log('auth success')
        updateAuthStatus('Authentication successful!', 'success');
        showSnackbar('WhatsApp authenticated successfully!');
        document.getElementById('qrCode').innerHTML = '';
    });

    client.on('auth_failure', () => {
        updateAuthStatus('Authentication failed!', 'error');
        showSnackbar('WhatsApp authentication failed!', 5000);
    });

    client.on('ready', () => {
        console.log("auth ready")
        updateAuthStatus('WhatsApp is ready to send messages', 'success');
        showSnackbar('WhatsApp is ready to use!');
    });

    client.on('disconnected', () => {
        console.log('Authenticated!');

        updateAuthStatus('WhatsApp disconnected', 'error');
        showSnackbar('WhatsApp disconnected. Please refresh the page.', 5000);
    });

    client.initialize().catch(err => {
        console.error('Client initialization failed:', err);
        updateAuthStatus('Initialization failed', 'error');
    });
}

function updateProgress(sent) {
    sentMessages = sent;
    const progress = (sent / totalMessages) * 100;
    document.getElementById('progressBarFill').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${sent}/${totalMessages} messages sent`;
}

// ... (rest of the code from the previous renderer.js remains the same)

async function startMessaging(filePath, imagePath, imageCaption, delays) {
    try {
        const numbers = readExcel(filePath);
        const media = MessageMedia.fromFilePath(imagePath);
        const timestamp = new Date().toISOString();

        for (let i = 0; i < numbers.length && isSending; i++) {
            const number = numbers[i];
            const formattedNumber = `${number.Phone}@c.us`;

            try {
                updateStatus(`Sending message to ${number.Phone}...`, 'success');

                await client.sendMessage(formattedNumber, media, { 
                    caption: imageCaption 
                });

                messageResults.push({
                    phone: number.Phone,
                    status: 'Success',
                    timestamp: new Date().toISOString(),
                    error: null
                });

                updateProgress(i + 1);

                const messageDelay = Math.floor(Math.random() * 
                    (delays.maxDelay - delays.minDelay + 1) + delays.minDelay);
                    console.log(messageDelay+'is huge')
                await new Promise(resolve => setTimeout(resolve, messageDelay));

            } catch (error) {
                messageResults.push({
                    phone: number.Phone,
                    status: 'Failed',
                    timestamp: new Date().toISOString(),
                    error: error.message
                });
                updateStatus(`Failed to send message to ${number.Phone}: ${error.message}`, 'error');
            }
        }

        document.getElementById('downloadReport').disabled = false;
        
        if (isSending) {
            updateStatus('Finished sending all messages!', 'success');
        }

    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
    } finally {
        isSending = false;
        document.getElementById('startSending').disabled = false;
        document.getElementById('stopSending').disabled = true;
    }
}

function readExcel(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet);
}

function generatePDFReport(fileName) {
    const doc = new PDFDocument();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // const reportPath = path.join(process.cwd(), `whatsapp_report_${timestamp}.pdf`);
    const reportPath = path.join(process.cwd(), `whatsapp_report_${path.basename(fileName, path.extname(fileName))}_${timestamp}.pdf`);

    const stream = fs.createWriteStream(reportPath);

    doc.pipe(stream);

    // Add header
    doc.fontSize(20).text('WhatsApp Messaging Report', { align: 'center' });
    doc.moveDown();

    // Add summary
    doc.fontSize(12)
        .text(`Total Messages: ${totalMessages}`)
        .text(`Successfully Sent: ${messageResults.filter(r => r.status === 'Success').length}`)
        .text(`Failed: ${messageResults.filter(r => r.status === 'Failed').length}`)
        .text(`Report Generated: ${new Date().toLocaleString()}`);

    doc.moveDown();

    // Add detailed results
    doc.fontSize(14).text('Detailed Results:', { underline: true });
    doc.moveDown();

    messageResults.forEach((result, index) => {
        doc.fontSize(10)
            .text(`${index + 1}. Phone: ${result.phone}`)
            .text(`   Status: ${result.status}`)
            .text(`   Time: ${new Date(result.timestamp).toLocaleString()}`)
            .text(`   ${result.error ? `Error: ${result.error}` : ''}`);
        doc.moveDown(0.5);
    });

    doc.end();

    stream.on('finish', () => {
        // After the PDF has been written, open it using the default system viewer
        const openCommand = process.platform === 'win32' ? 'start' : 
        process.platform === 'darwin' ? 'open' : 'xdg-open';

executeCommand(`${openCommand} ${reportPath}`)})

    updateStatus(`Report saved as: ${reportPath}`, 'success');
}


function executeCommand(command) {
    ipcRenderer.send('execute-command', command);

    ipcRenderer.on('command-result', (event, result) => {
        if (result.success) {
            console.log('Command executed successfully:', result.output);
        } else {
            console.error('Command execution failed:', result.error);
        }
    });
}

// Add these at the bottom of renderer.js, before initializeWhatsApp();

// File selection handlers
document.getElementById('selectFile').addEventListener('click', async () => {
    try {
        const filePath = await ipcRenderer.invoke('select-file');
        if (filePath) {
            selectedFilePath = filePath;
            document.getElementById('selectedFile').textContent = path.basename(filePath);
            const numbers = readExcel(filePath);
            totalMessages = numbers.length;
            showSnackbar(`Loaded ${totalMessages} numbers from Excel file`);
        }
    } catch (error) {
        showSnackbar('Error selecting Excel file: ' + error.message, 5000);
    }
});

document.getElementById('selectImage').addEventListener('click', async () => {
    try {
        const imagePath = await ipcRenderer.invoke('select-image');
        if (imagePath) {
            selectedImagePath = imagePath;
            document.getElementById('selectedImage').textContent = path.basename(imagePath);
            // Show image preview
            const imagePreview = document.getElementById('imagePreview');
            imagePreview.innerHTML = `<img src="file://${imagePath}" class="preview-image">`;
        }
    } catch (error) {
        showSnackbar('Error selecting image: ' + error.message, 5000);
    }
});

// Start sending button handler
document.getElementById('startSending').addEventListener('click', async () => {
    if (!selectedFilePath || !selectedImagePath) {
        showSnackbar('Please select both Excel file and image first!', 3000);
        return;
    }

    const imageCaption = document.getElementById('imageCaption').value;
    const minDelay = parseInt(document.getElementById('minDelay').value);
    const maxDelay = parseInt(document.getElementById('maxDelay').value);

    if (minDelay >= maxDelay) {
        showSnackbar('Maximum delay should be greater than minimum delay', 3000);
        return;
    }

    isSending = true;
    document.getElementById('startSending').disabled = true;
    document.getElementById('stopSending').disabled = false;
    document.getElementById('downloadReport').disabled = true;

    const delays = {
        minDelay: minDelay * 1000,
        maxDelay: maxDelay * 1000
    };

    await startMessaging(selectedFilePath, selectedImagePath, imageCaption, delays);
});

// Stop sending button handler
document.getElementById('stopSending').addEventListener('click', () => {
    isSending = false;
    document.getElementById('startSending').disabled = false;
    document.getElementById('stopSending').disabled = true;
    document.getElementById('downloadReport').disabled = false;
    showSnackbar('Sending stopped by user');
});

// Download report button handler
document.getElementById('downloadReport').addEventListener('click', () => {
    try {
        generatePDFReport(selectedFilePath);
        showSnackbar('Report generated successfully!');
    } catch (error) {
        showSnackbar('Error generating report: ' + error.message, 5000);
    }
});

// Update the updateStatus function
function updateStatus(message, type) {
    showSnackbar(message);
    if (type === 'success') {
        updateAuthStatus(message, 'success');
    } else if (type === 'error') {
        updateAuthStatus(message, 'error');
    }
}

// Initialize the WhatsApp client


function cleanup() {
    if (client) {
        client.destroy()
            .then(() => console.log('Client destroyed successfully'))
            .catch(err => console.error('Error destroying client:', err));
    }
}

// Initialize WhatsApp client when the app starts
initializeWhatsApp();

// Handle cleanup when the window is closing
window.addEventListener('beforeunload', cleanup);
// Initialize WhatsApp client when the app starts
