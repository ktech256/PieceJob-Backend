// @ts-ignore
import PDFDocument from 'pdfkit';
import { Stream } from 'stream';

export interface PDFData {
  title: string;
  items: { label: string; value: string }[];
  footer?: string;
  logoUrl?: string;
  companyDetails?: {
    name: string;
    address: string;
    email: string;
    phone: string;
  };
}

export const generatePDF = async (data: PDFData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);

    // 1. Header
    if (data.logoUrl) {
      // In a real environment, you'd fetch the image and add it
      // doc.image(data.logoUrl, 50, 45, { width: 50 });
    }

    doc
      .fillColor('#444444')
      .fontSize(20)
      .text(data.title, 50, 50, { align: 'right' })
      .fontSize(10)
      .text(data.companyDetails?.name || 'PieceJob', 50, 65, { align: 'right' })
      .text(data.companyDetails?.address || '', 50, 80, { align: 'right' })
      .text(`${data.companyDetails?.email || ''} | ${data.companyDetails?.phone || ''}`, 50, 95, { align: 'right' })
      .moveDown();

    // 2. Divider
    doc
      .strokeColor('#aaaaaa')
      .lineWidth(1)
      .moveTo(50, 115)
      .lineTo(550, 115)
      .stroke();

    // 3. Content
    let y = 150;
    data.items.forEach(item => {
      doc
        .fontSize(10)
        .text(item.label, 50, y)
        .font('Helvetica-Bold')
        .text(item.value, 150, y)
        .font('Helvetica')
        .moveDown();
      y += 20;
    });

    // 4. Footer
    if (data.footer) {
      doc
        .fontSize(10)
        .text(data.footer, 50, 700, { align: 'center', width: 500 });
    }

    doc.end();
  });
};
