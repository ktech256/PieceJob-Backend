import { generatePDF } from './pdf.service';
import Job from '../models/Job';
import User from '../models/User';
import Invoice from '../models/Invoice';
import Statement from '../models/Statement';
import { logger } from '../utils/logger';

export const getAttachmentsForEmail = async (templateCode: string, templateData: any): Promise<any[]> => {
  try {
    const attachments: any[] = [];

    if (templateCode === 'JOB_COMPLETED_RECEIPT' && templateData.jobId) {
      const pdf = await generateJobReceiptPDF(templateData.jobId);
      attachments.push({
        filename: `Receipt-${templateData.jobId.slice(-6)}.pdf`,
        content: pdf
      });
    }

    if (templateCode === 'TAX_INVOICE' && templateData.invoiceId) {
      const pdf = await generateInvoicePDF(templateData.invoiceId);
      attachments.push({
        filename: `Invoice-${templateData.invoiceNumber}.pdf`,
        content: pdf
      });
    }

    if (templateCode === 'MONTHLY_STATEMENT' && templateData.statementId) {
        const pdf = await generateStatementPDF(templateData.statementId);
        attachments.push({
          filename: `Statement-${templateData.period}.pdf`,
          content: pdf
        });
    }

    return attachments;
  } catch (error: any) {
    logger.error(`EMAIL_ATTACHMENT | FAILED | Template: ${templateCode} | Error: ${error.message}`);
    return [];
  }
};

const generateJobReceiptPDF = async (jobId: string) => {
  const job = await Job.findById(jobId).populate('customerId providerId');
  if (!job) throw new Error('Job not found');

  return await generatePDF({
    title: 'OFFICIAL RECEIPT',
    items: [
      { label: 'Job ID', value: job._id.toString() },
      { label: 'Service', value: job.serviceName || job.serviceCode },
      { label: 'Date', value: job.createdAt.toDateString() },
      { label: 'Amount', value: `${job.pricingSnapshot?.currencyCode || 'R'} ${job.bookingFee.toFixed(2)}` },
      { label: 'Status', value: 'PAID' }
    ],
    companyDetails: {
      name: 'PieceJob (Pty) Ltd',
      address: 'Johannesburg, South Africa',
      email: 'support@piecejob.co',
      phone: '+27 11 000 0000'
    }
  });
};

const generateInvoicePDF = async (invoiceId: string) => {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    return await generatePDF({
      title: 'TAX INVOICE',
      items: [
        { label: 'Invoice No', value: invoice.invoiceNumber },
        { label: 'Date', value: invoice.createdAt.toDateString() },
        { label: 'Amount', value: `${invoice.currency} ${invoice.amount.toFixed(2)}` }
      ]
    });
};

const generateStatementPDF = async (statementId: string) => {
    const statement = await Statement.findById(statementId);
    if (!statement) throw new Error('Statement not found');

    return await generatePDF({
      title: 'MONTHLY STATEMENT',
      items: [
        { label: 'Period', value: `${statement.periodStart.toDateString()} - ${statement.periodEnd.toDateString()}` },
        { label: 'Gross', value: statement.summary.grossEarnings?.toString() || '0' },
        { label: 'Net', value: statement.summary.netEarnings?.toString() || '0' }
      ]
    });
};
