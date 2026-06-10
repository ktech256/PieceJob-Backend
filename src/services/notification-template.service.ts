import NotificationTemplate, { INotificationTemplate } from '../models/NotificationTemplate';

export const getTemplate = async (code: string, channel: 'PUSH' | 'SMS' | 'EMAIL', countryCode: string = 'GLOBAL', lang: string = 'EN') => {
    // Try to find country specific template first
    let template = await NotificationTemplate.findOne({ templateCode: code, channel, countryCode, language: lang, active: true });

    // Fallback to GLOBAL if not found
    if (!template && countryCode !== 'GLOBAL') {
        template = await NotificationTemplate.findOne({ templateCode: code, channel, countryCode: 'GLOBAL', language: lang, active: true });
    }

    return template;
};

export const resolveTemplate = (template: INotificationTemplate, data: Record<string, string>) => {
    let title = template.title || '';
    let body = template.body;
    let subject = template.subject || '';

    Object.entries(data).forEach(([key, value]) => {
        const placeholder = `{{${key}}}`;
        const regex = new RegExp(placeholder, 'g');
        title = title.replace(regex, value);
        body = body.replace(regex, value);
        subject = subject.replace(regex, value);
    });

    return { title, body, subject };
};

export const listTemplates = async (query: any) => {
    return await NotificationTemplate.find(query).sort({ templateCode: 1, countryCode: 1 });
};

export const validatePlaceholders = (body: string, placeholders: string[]) => {
    // 1. Check for illegal characters/scripts
    if (/<script|DROP TABLE|DELETE FROM|SELECT \*|UPDATE .* SET/i.test(body)) {
        throw new Error('MALICIOUS_CONTENT_DETECTED');
    }

    // 2. Check for spaces in placeholders
    const invalidFormat = body.match(/{{[^}]+ }}/g) || body.match(/{{ [^}]+}}/g);
    if (invalidFormat) {
        throw new Error('INVALID_PLACEHOLDER_FORMAT');
    }

    // 3. Extract all placeholders from body
    const matches = body.match(/{{[a-zA-Z0-9_]+}}/g) || [];
    const extracted = matches.map(m => m.replace(/{{|}}/g, ''));

    // 4. Verify all extracted placeholders are in the approved list
    const unapproved = extracted.filter(p => !placeholders.includes(p));
    if (unapproved.length > 0) {
        throw new Error(`UNAPPROVED_PLACEHOLDERS: ${unapproved.join(', ')}`);
    }

    return true;
};

export const createTemplate = async (data: any) => {
    validatePlaceholders(data.body, data.placeholders || []);
    const template = new NotificationTemplate(data);
    return await template.save();
};

export const updateTemplate = async (id: string, data: any) => {
    if (data.body) {
        // Fetch existing placeholders if not provided in update
        let placeholders = data.placeholders;
        if (!placeholders) {
            const existing = await NotificationTemplate.findById(id);
            placeholders = existing?.placeholders || [];
        }
        validatePlaceholders(data.body, placeholders);
    }
    return await NotificationTemplate.findByIdAndUpdate(id, {
        ...data,
        $inc: { version: 1 } // Auto-increment version on update
    }, { new: true });
};
