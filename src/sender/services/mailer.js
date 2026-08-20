import nodemailer from 'nodemailer';
import * as cheerio from 'cheerio';
import { generateSignedUrl } from './hmac.js';

/**
 * Creates an SMTP Transporter dynamically using the user's provided credentials.
 */
const createTransporter = (smtpConfig) => {
    return nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465, // true for 465 (SMTPS), false for other ports
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass
        }
    });
};

/**
 * Injects the Open Tracking pixel and wraps all <a> tags with the HMAC secure redirect Base64 payload.
 * Both behaviours can be disabled independently via the options object.
 *
 * @param {string} rawHtml - The raw email body from the Composer
 * @param {string} recipientId - Unique ID of the Recipient record
 * @param {string} hostUrl - The base URL of the Sender dashboard (e.g., http://localhost:3000)
 * @param {object} [options]
 * @param {boolean} [options.openTrackingEnabled=true]  - Whether to inject the 1x1 open-tracking pixel
 * @param {boolean} [options.clickTrackingEnabled=true] - Whether to wrap links with signed redirect URLs
 * @returns {string} The fully tracked (or partially tracked) HTML string ready to send
 */
const injectTrackingHtml = (rawHtml, recipientId, hostUrl, {
    openTrackingEnabled  = true,
    clickTrackingEnabled = true
} = {}) => {
    // 1. Load HTML into Cheerio parser
    const $ = cheerio.load(rawHtml, null, false); // false prevents Cheerio from wrapping in <html><body>

    // 2. Wrap all anchor tags for Click Tracking (only when enabled)
    if (clickTrackingEnabled) {
        $('a').each((i, el) => {
            const originalHref = $(el).attr('href');
            if (originalHref && (originalHref.startsWith('http://') || originalHref.startsWith('https://'))) {
                const trackingUrl = generateSignedUrl(hostUrl, recipientId, originalHref);
                $(el).attr('href', trackingUrl);
            }
        });
    }

    // 3. Inject the 1x1 Transparent Open Tracking Pixel at the very end (only when enabled)
    if (openTrackingEnabled) {
        const pixelUrl = `${hostUrl}/track/o/${recipientId}.gif`;
        $.root().append(`<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`);
    }

    return $.html();
};

/**
 * Dispatches an email through the user's SMTP.
 * Returns { ok: true } on success or { ok: false, error: '...' } on failure.
 */
const sendEmail = async (transporter, fromData, toEmail, subject, trackedHtml) => {
    try {
        const info = await transporter.sendMail({
            from: `"${fromData.name}" <${fromData.email}>`,
            to: toEmail,
            subject: subject,
            html: trackedHtml
        });

        console.log(`[SMTP] Sent to ${toEmail}: ${info.messageId}`);
        return { ok: true };
    } catch (error) {
        console.error(`[SMTP ERROR] Failed to send to ${toEmail}: ${error.message}`);
        return { ok: false, error: error.message };
    }
};

export {
    createTransporter,
    injectTrackingHtml,
    sendEmail
};
