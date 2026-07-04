import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </button>

        <h1 className="text-3xl font-extrabold text-slate-900 mb-6">Privacy Policy</h1>
        
        <div className="prose prose-slate prose-sm sm:prose-base max-w-none text-slate-700">
          <p><strong>Last Updated: {new Date().toLocaleDateString()}</strong></p>

          <h2>1. Information We Collect</h2>
          <p>
            We collect information that you provide directly to us when you register for an account, update your profile, use our services, or communicate with us. This includes:
          </p>
          <ul>
            <li>Contact information (such as name, email address).</li>
            <li>Business profile data.</li>
            <li>Tender documents and information you upload for analysis.</li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>
            We use the information we collect to provide, maintain, and improve our services, to process your transactions, and to communicate with you. Your uploaded documents are used strictly to provide the AI analysis and generation features you request.
          </p>

          <h2>3. Data Security</h2>
          <p>
            We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. We use secure servers and encryption for data transmission.
          </p>

          <h2>4. Sharing of Information</h2>
          <p>
            We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties except as necessary to provide our services (e.g., sharing payment information securely with Razorpay) or when required by law.
          </p>

          <h2>5. Your Choices</h2>
          <p>
            You may update or correct your account information at any time by logging into your account settings. You can also contact us to request deletion of your personal data.
          </p>

          <h2>6. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.
          </p>

          <h2>7. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us.
          </p>
        </div>
      </div>
    </div>
  );
}
