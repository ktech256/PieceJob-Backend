import { generatePDF } from './pdf.service';
import Job from '../models/Job';
import User from '../models/User';
import Invoice from '../models/Invoice';
import Statement from '../models/Statement';
import { logger } from '../utils/logger';

export const getAttachmentsForEmail = async (templateCode: string, templateData: any): Promise<any[]> => {
  try {
    const attachments: any[] = [];

    // Mission Critical logging for forensic verification
    const jobId = templateData.jobId || templateData.id;
    logger.info(`EMAIL_ATTACHMENT | ANALYZING | Template: ${templateCode} | Target ID: ${jobId}`);

    if (templateCode === 'JOB_COMPLETED_RECEIPT' && jobId) {
      // NOTE: For Job Completed emails to customers, we no longer attach the PDF.
      // The email body itself is the high-fidelity receipt.
      // A download button in the HTML will point to the secure retrieval endpoint.
      logger.info(`EMAIL_ATTACHMENT | SKIPPED | PDF Attachment removed for Customer Receipt: ${jobId}. Body-Receipt active.`);
    }

    if (templateCode === 'PROVIDER_JOB_COMPLETED' && jobId) {
      logger.info(`EMAIL_ATTACHMENT | GENERATING_PDF | Provider Earnings: ${jobId}`);
      const pdf = await generateProviderEarningsPDF(jobId);
      if (pdf) {
          attachments.push({
              filename: `Earnings-Receipt-${jobId.toString().slice(-6)}.pdf`,
              content: pdf,
              contentType: 'application/pdf'
          });
      }
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

export const generateJobReceiptPDF = async (jobId: string) => {
  const job = await Job.findById(jobId).populate('customerId providerId');
  if (!job) throw new Error('Job not found');

  return await generatePDF({
    title: 'OFFICIAL TAX RECEIPT',
    items: [
      { label: 'Receipt No.', value: `PJ-RC-${job._id.toString().toUpperCase()}` },
      { label: 'Job Reference', value: `#${job._id.toString().slice(-6)}` },
      { label: 'Service', value: job.serviceName || job.serviceCode },
      { label: 'Professional', value: job.providerId ? `${(job.providerId as any).firstName} ${(job.providerId as any).lastName}` : 'N/A' },
      { label: 'Date', value: job.createdAt.toDateString() },
      { label: 'Amount Paid', value: `${job.pricingSnapshot?.currencyCode || 'R'} ${job.bookingFee.toFixed(2)}` },
      { label: 'Status', value: 'PAID / COMPLETED' }
    ],
    companyDetails: {
      name: 'PieceJob (Pty) Ltd',
      address: 'Oracle North, Johannesburg, South Africa',
      email: 'support@piecejob.co',
      phone: '+27 11 000 0000'
    }
  });
};

const generateProviderEarningsPDF = async (jobId: string) => {
    const job = await Job.findById(jobId).populate('customerId providerId');
    if (!job) throw new Error('Job not found');

    const serviceAmt = job.agreedPrice || job.serviceFee || 0;
    const grossAmount = serviceAmt + job.bookingFee;

    // Simple logic match for email
    const serviceFeeRate = job.serviceFeeRateSnapshot || 15;
    const isNegotiated = job.priceNegotiationRequired !== false;
    const totalServiceFee = isNegotiated ? (job.agreedPrice || (job.serviceFee || 0) + job.bookingFee) * (serviceFeeRate / 100) : job.bookingFee;
    const netEarnings = (job.agreedPrice || (job.serviceFee || 0) + job.bookingFee) - totalServiceFee;

    return await generatePDF({
      title: 'PROVIDER EARNINGS RECEIPT',
      items: [
        { label: 'Job ID', value: `#${job._id.toString().slice(-6)}` },
        { label: 'Service', value: job.serviceName || job.serviceCode },
        { label: 'Date', value: job.completedAt?.toDateString() || new Date().toDateString() },
        { label: 'Gross Job Value', value: `${job.pricingSnapshot?.currencyCode || 'R'} ${grossAmount.toFixed(2)}` },
        { label: 'Platform Service Fee', value: `${job.pricingSnapshot?.currencyCode || 'R'} ${totalServiceFee.toFixed(2)}` },
        { label: 'Net Earnings', value: `${job.pricingSnapshot?.currencyCode || 'R'} ${netEarnings.toFixed(2)}` },
        { label: 'Status', value: 'CREDITED TO ESCROW' }
      ],
      companyDetails: {
        name: 'PieceJob (Pty) Ltd - Provider Network',
        address: 'Oracle North, Johannesburg, South Africa',
        email: 'pro-support@piecejob.co',
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
