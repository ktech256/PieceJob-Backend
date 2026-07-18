// @ts-ignore
import PDFDocument from 'pdfkit';
import axios from 'axios';

export interface PDFItem {
    label: string;
    value: string;
    isBold?: boolean;
    color?: string;
}

export interface PDFSection {
    title?: string;
    items: PDFItem[];
}

export interface PDFData {
    title: string;
    logoUrl?: string;
    brandColor?: string;
    sections: PDFSection[];
    financials?: {
        label: string;
        value: string;
        items: PDFItem[];
    };
    timeline?: { event: string; time: string }[];
    footer?: {
        text: string;
        companyInfo?: string;
    };
    support?: {
        email: string;
        phone: string;
        website: string;
    };
}

export const generatePDF = async (data: PDFData): Promise<Buffer> => {
    return new Promise(async (resolve, reject) => {
        const doc = new PDFDocument({
            margin: 0, // We'll handle margins manually for the header
            size: 'A4'
        });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            resolve(Buffer.concat(buffers));
        });
        doc.on('error', reject);

        const brandColor = data.brandColor || '#FF9900';
        const margin = 50;
        const pageWidth = doc.page.width;

        // 1. Header (Black Background like the email)
        doc.rect(0, 0, pageWidth, 160).fill('#121212');

        try {
            // Attempt to load logo if provided
            const logoUrl = data.logoUrl || 'https://piecejob.co/assets/logos/piecejob-logo.png';
            const response = await axios.get(logoUrl, { responseType: 'arraybuffer' });
            doc.image(response.data, (pageWidth - 120) / 2, 35, { width: 120 });
        } catch (e) {
            // Fallback text logo if image fails
            doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold').text('PieceJob', 0, 50, { align: 'center' });
        }

        doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold').text(data.title.toUpperCase(), 0, 115, { align: 'center', characterSpacing: 1 });

        // 2. Main Content Area
        let y = 190;

        // Render Sections
        data.sections.forEach(section => {
            if (y > doc.page.height - 100) { doc.addPage(); y = 50; }

            if (section.title) {
                doc.fillColor('#999999').fontSize(9).font('Helvetica-Bold').text(section.title.toUpperCase(), margin, y, { characterSpacing: 1 });
                y += 20;
            }

            section.items.forEach(item => {
                doc.fillColor('#666666').fontSize(10).font('Helvetica').text(item.label, margin, y);
                doc.fillColor(item.color || '#121212').font(item.isBold ? 'Helvetica-Bold' : 'Helvetica').text(item.value, margin, y, { align: 'right', width: pageWidth - (margin * 2) });
                y += 18;
            });
            y += 15;
        });

        // 3. Financial Summary Card
        if (data.financials) {
            if (y > doc.page.height - 200) { doc.addPage(); y = 50; }

            // Card Background
            doc.roundedRect(margin, y, pageWidth - (margin * 2), 120, 15).fill('#F9F9F9');
            doc.rect(margin, y, pageWidth - (margin * 2), 120).stroke('#EEEEEE');

            let fy = y + 20;
            doc.fillColor('#121212').fontSize(11).font('Helvetica-Bold').text(data.financials.label.toUpperCase(), margin + 20, fy);

            data.financials.items.forEach(item => {
                fy += 22;
                doc.fillColor('#666666').fontSize(10).font('Helvetica').text(item.label, margin + 20, fy);
                doc.fillColor('#121212').font('Helvetica-Bold').text(item.value, margin + 20, fy, { align: 'right', width: pageWidth - (margin * 2) - 40 });
            });

            // Highlight Total
            fy += 30;
            doc.rect(margin + 20, fy - 10, pageWidth - (margin * 2) - 40, 1).fill('#DDDDDD');
            doc.fillColor(brandColor).fontSize(18).font('Helvetica-Bold').text('TOTAL PAID', margin + 20, fy);
            doc.text(data.financials.value, margin + 20, fy, { align: 'right', width: pageWidth - (margin * 2) - 40 });

            y = fy + 50;
        }

        // 4. Timeline
        if (data.timeline && data.timeline.length > 0) {
            if (y > doc.page.height - 150) { doc.addPage(); y = 50; }

            doc.fillColor('#999999').fontSize(9).font('Helvetica-Bold').text('JOB TIMELINE', margin, y, { characterSpacing: 1 });
            y += 25;

            data.timeline.forEach((point, index) => {
                doc.circle(margin + 5, y + 5, 3).fill(brandColor);
                if (index < data.timeline.length - 1) {
                    doc.moveTo(margin + 5, y + 8).lineTo(margin + 5, y + 22).stroke('#EEEEEE');
                }
                doc.fillColor('#666666').fontSize(9).font('Helvetica').text(point.event, margin + 20, y);
                doc.fillColor('#BBBBBB').text(point.time, margin + 20, y, { align: 'right', width: pageWidth - (margin * 2) - 25 });
                y += 20;
            });
            y += 20;
        }

        // 5. Support Section
        if (data.support) {
            if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
            doc.roundedRect(margin, y, pageWidth - (margin * 2), 60, 10).fill('#F4F4F4');
            doc.fillColor('#666666').fontSize(9).font('Helvetica').text('Need help with this receipt?', 0, y + 15, { align: 'center' });
            doc.fillColor(brandColor).font('Helvetica-Bold').text(`${data.support.email} | ${data.support.website}`, 0, y + 30, { align: 'center' });
            y += 80;
        }

        // 6. Footer
        const footerY = doc.page.height - 70;
        doc.fillColor('#BBBBBB').fontSize(8).font('Helvetica').text(data.footer?.text || '', 0, footerY, { align: 'center' });
        doc.text(data.footer?.companyInfo || '', 0, footerY + 12, { align: 'center' });

        doc.end();
    });
};
