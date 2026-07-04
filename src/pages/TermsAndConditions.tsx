import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsAndConditions() {
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
        
        <h1 className="text-3xl font-extrabold text-slate-900 mb-6">Terms and Conditions</h1>
        
        <div className="prose prose-slate prose-sm sm:prose-base max-w-none text-slate-700">
          <p><strong>Last Updated: {new Date().toLocaleDateString()}</strong></p>

          <h2>1. Introduction</h2>
          <p>
            Welcome to Tender MasterAI. By accessing or using our application, you agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not agree to these terms, please do not use our services.
          </p>

          <h2>2. Use of Services</h2>
          <p>
            You agree to use our services only for lawful purposes and in accordance with these Terms. You are responsible for any information you provide while using the service.
          </p>

          <h2>3. Account Registration</h2>
          <p>
            To access certain features of the service, you may be required to register for an account. You agree to provide accurate, current, and complete information during the registration process and to update such information to keep it accurate, current, and complete.
          </p>

          <h2>4. Payments and Subscriptions</h2>
          <p>
            If you choose to purchase a subscription, you agree to pay the fees associated with the plan. All payments are processed securely through our third-party payment processors (e.g., Razorpay). Subscriptions are billed in advance on a recurring basis.
          </p>

          <h2>5. Intellectual Property</h2>
          <p>
            The content, features, and functionality of the application, including but not limited to the AI analysis tools and generated documents, are owned by us and are protected by copyright, trademark, and other intellectual property laws.
          </p>

          <h2>6. Limitation of Liability</h2>
          <p>
            In no event shall we be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the service.
          </p>

          <h2>7. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify you of any changes by posting the new Terms on this page.
          </p>

          <h2>8. Contact Us</h2>
          <p>
            If you have any questions about these Terms, please contact us.
          </p>
        </div>
      </div>
    </div>
  );
}
