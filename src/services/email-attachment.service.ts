import { generatePDF, PDFData } from './pdf.service';
import Job from '../models/Job';
import User from '../models/User';
import Provider from '../models/Provider';
import Invoice from '../models/Invoice';
import Statement from '../models/Statement';
import { logger } from '../utils/logger';

export const getAttachmentsForEmail = async (templateCode: string, templateData: any): Promise<any[]> => {
  try {
    const attachments: any[] = [];
    const jobId = templateData.jobId || templateData.id;

    if (templateCode === 'JOB_COMPLETED_RECEIPT' && jobId) {
        // Customer Receipt is now body-only with download link
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

  const providerStats = await Provider.findOne({ userId: job.providerId });

  // CORRECT CALCULATION (Consistent with enterprise receipt email)
  const totalPaid = job.agreedPrice || (job.serviceFee || 0) + job.bookingFee;
  const serviceAmt = totalPaid - job.bookingFee;
  const currency = job.pricingSnapshot?.currencyCode || 'R';

  // Extract Suburb/City (Hide Street Address)
  const fullAddress = job.location?.address || "";
  const parts = fullAddress.split(',').map(s => s.trim());
  const suburb = parts.length > 2 ? parts[parts.length - 3] : (parts.length > 1 ? parts[0] : "Local Area");
  const city = parts.length > 1 ? parts[parts.length - 2] : "PieceJob Zone";

  const pdfData: PDFData = {
      title: 'Payment Receipt',
      brandColor: '#FF9900', // Customer Orange
      sections: [
          {
              title: 'Customer Information',
              items: [
                  { label: 'Customer Name', value: (job.customerId as any).firstName + ' ' + (job.customerId as any).lastName },
                  { label: 'Professional', value: job.providerId ? `${(job.providerId as any).firstName} ${(job.providerId as any).lastName}` : 'N/A' },
                  { label: 'Provider Rating', value: providerStats?.ratingAvg?.toFixed(1) || '5.0' }
              ]
          },
          {
              title: 'Job Details',
              items: [
                  { label: 'Job Reference', value: `#${job._id.toString().slice(-6)}`, isBold: true },
                  { label: 'Service', value: job.serviceName || job.serviceCode },
                  { label: 'Location', value: `${suburb}, ${city}` },
                  { label: 'Completion Date', value: job.completedAt?.toLocaleString() || new Date().toLocaleString() }
              ]
          }
      ],
      financials: {
          label: 'Payment Summary',
          value: `${currency} ${totalPaid.toFixed(2)}`,
          items: [
              { label: 'Booking Fee', value: `${currency} ${job.bookingFee.toFixed(2)}` },
              { label: 'Provider Service', value: `${currency} ${serviceAmt.toFixed(2)}` }
          ]
      },
      timeline: [
          { event: 'Booking Created', time: job.createdAt.toLocaleTimeString() },
          { event: 'Provider Accepted', time: job.acceptedAt?.toLocaleTimeString() || '--:--' },
          { event: 'Job Started', time: job.startedAt?.toLocaleTimeString() || '--:--' },
          { event: 'Job Completed', time: job.completedAt?.toLocaleTimeString() || '--:--' }
      ],
      support: {
          email: 'support@piecejob.co',
          phone: '+27 11 000 0000',
          website: 'www.piecejob.co'
      },
      footer: {
          text: '© 2026 PieceJob (Pty) Ltd. All rights reserved.',
          companyInfo: 'Oracle North, Johannesburg, South Africa'
      }
  };

  return await generatePDF(pdfData);
};

const generateProviderEarningsPDF = async (jobId: string) => {
    const job = await Job.findById(jobId).populate('customerId providerId');
    if (!job) throw new Error('Job not found');

    const totalPaid = job.agreedPrice || (job.serviceFee || 0) + job.bookingFee;
    const grossAmount = totalPaid;
    const serviceFeeRate = job.serviceFeeRateSnapshot || 15;
    const isNegotiated = job.priceNegotiationRequired !== false;
    const totalServiceFee = isNegotiated ? totalPaid * (serviceFeeRate / 100) : job.bookingFee;
    const netEarnings = totalPaid - totalServiceFee;
    const currency = job.pricingSnapshot?.currencyCode || 'R';

    const pdfData: PDFData = {
        title: 'Earnings Receipt',
        brandColor: '#2E7D32', // Provider Green
        sections: [
            {
                title: 'Earnings Summary',
                items: [
                    { label: 'Job Reference', value: `#${job._id.toString().slice(-6)}`, isBold: true },
                    { label: 'Customer', value: (job.customerId as any).firstName },
                    { label: 'Service Rendered', value: job.serviceName || job.serviceCode },
                    { label: 'Status', value: 'CREDITED TO ESCROW', color: '#2E7D32', isBold: true }
                ]
            }
        ],
        financials: {
            label: 'Payout Breakdown',
            value: `${currency} ${netEarnings.toFixed(2)}`,
            items: [
                { label: 'Gross Job Value', value: `${currency} ${grossAmount.toFixed(2)}` },
                { label: 'Platform Service Fee', value: `- ${currency} ${totalServiceFee.toFixed(2)}`, color: '#D32F2F' }
            ]
        },
        footer: {
            text: '© 2026 PieceJob Provider Network',
            companyInfo: 'Oracle North, Johannesburg, South Africa'
        },
        support: {
            email: 'pro-support@piecejob.co',
            phone: '+27 11 000 0000',
            website: 'www.piecejob.co/pro'
        }
    };

    return await generatePDF(pdfData);
};

const generateInvoicePDF = async (invoiceId: string) => {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const pdfData: PDFData = {
        title: 'Tax Invoice',
        sections: [
            {
                items: [
                    { label: 'Invoice Number', value: invoice.invoiceNumber, isBold: true },
                    { label: 'Date', value: invoice.createdAt.toDateString() },
                    { label: 'Amount', value: `${invoice.currency} ${invoice.amount.toFixed(2)}` }
                ]
            }
        ],
        footer: {
            text: 'Official Tax Invoice'
        }
    };

    return await generatePDF(pdfData);
};

const generateStatementPDF = async (statementId: string) => {
    const statement = await Statement.findById(statementId);
    if (!statement) throw new Error('Statement not found');

    const pdfData: PDFData = {
        title: 'Monthly Statement',
        brandColor: '#2E7D32',
        sections: [
            {
                items: [
                    { label: 'Period', value: `${statement.periodStart.toDateString()} - ${statement.periodEnd.toDateString()}` },
                    { label: 'Gross Earnings', value: statement.summary.grossEarnings?.toString() || '0' },
                    { label: 'Net Earnings', value: statement.summary.netEarnings?.toString() || '0' }
                ]
            }
        ],
        footer: {
            text: 'PieceJob Provider Monthly Activity Statement'
        }
    };

    return await generatePDF(pdfData);
};
