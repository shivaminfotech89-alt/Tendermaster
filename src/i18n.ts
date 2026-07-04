import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Translation files
const resources = {
  en: {
    translation: {
      "app_title": "AI Studio Applet",
      "login_title": "Welcome Back",
      "signup_title": "Create an Account",
      "email": "Email Address",
      "password": "Password",
      "login_button": "Log In",
      "signup_button": "Sign Up",
      "logging_in": "Logging in...",
      "signing_up": "Creating account...",
      "continue_with_google": "Continue with Google",
      "dont_have_account": "Don't have an account?",
      "already_have_account": "Already have an account?",
      "or": "or",
      "dashboard": "Dashboard",
      "projects": "Projects",
      "analyzer": "Tender Analyzer",
      "chat": "Tender Chat",
      "documents": "Documents",
      "reports": "Reports",
      "notifications": "Notifications",
      "profile": "Business Profile",
      "settings": "Settings",
      "admin_panel": "Admin Panel",
      "super_admin": "Super Admin",
      "admin": "Admin",
      "logout": "Log Out",
      "free_plan": "Free Plan",
      "premium_plan": "Premium Plan",
      "admin_access": "Admin Access",
      "superadmin_access": "Superadmin Access",
      "upgrade_to_premium": "Upgrade to Premium",
      "enter_activation_code": "Enter Activation Code",
      "activation_code": "Activation Code",
      "activate": "Activate",
      "days_remaining": "Days Remaining",
      "locked_feature": "Premium Feature",
      "premium_required": "This feature requires a premium subscription."
    }
  },
  hi: {
    translation: {
      "app_title": "एआई स्टूडियो एप्लेट",
      "login_title": "वापसी पर स्वागत है",
      "signup_title": "खाता बनाएं",
      "email": "ईमेल पता",
      "password": "पासवर्ड",
      "login_button": "लॉग इन करें",
      "signup_button": "साइन अप करें",
      "logging_in": "लॉग इन हो रहा है...",
      "signing_up": "खाता बन रहा है...",
      "continue_with_google": "Google के साथ जारी रखें",
      "dont_have_account": "क्या आपके पास खाता नहीं है?",
      "already_have_account": "क्या आपके पास पहले से खाता है?",
      "or": "या",
      "dashboard": "डैशबोर्ड",
      "projects": "प्रोजेक्ट्स",
      "analyzer": "टेंडर एनालाइजर",
      "chat": "टेंडर चैट",
      "documents": "दस्तावेज़",
      "reports": "रिपोर्ट्स",
      "notifications": "सूचनाएं",
      "profile": "व्यापार प्रोफ़ाइल",
      "settings": "सेटिंग्स",
      "admin_panel": "एडमिन पैनल",
      "super_admin": "सुपर एडमिन",
      "admin": "एडमिन",
      "logout": "लॉग आउट",
      "free_plan": "मुफ्त योजना",
      "premium_plan": "प्रीमियम योजना",
      "admin_access": "एडमिन एक्सेस",
      "superadmin_access": "सुपरएडमिन एक्सेस",
      "upgrade_to_premium": "प्रीमियम में अपग्रेड करें",
      "enter_activation_code": "एक्टिवेशन कोड दर्ज करें",
      "activation_code": "एक्टिवेशन कोड",
      "activate": "सक्रिय करें",
      "days_remaining": "दिन शेष",
      "locked_feature": "प्रीमियम सुविधा",
      "premium_required": "इस सुविधा के लिए प्रीमियम सदस्यता की आवश्यकता है।"
    }
  },
  gu: {
    translation: {
      "app_title": "એઆઈ સ્ટુડિયો એપલેટ",
      "login_title": "ફરીથી સ્વાગત છે",
      "signup_title": "એક ખાતું બનાવો",
      "email": "ઇમેઇલ સરનામું",
      "password": "પાસવર્ડ",
      "login_button": "લોગ ઇન કરો",
      "signup_button": "સાઇન અપ કરો",
      "logging_in": "લોગ ઇન થઈ રહ્યું છે...",
      "signing_up": "ખાતું બની રહ્યું છે...",
      "continue_with_google": "Google સાથે ચાલુ રાખો",
      "dont_have_account": "શું તમારી પાસે ખાતું નથી?",
      "already_have_account": "શું તમારી પાસે પહેલેથી જ ખાતું છે?",
      "or": "અથવા",
      "dashboard": "ડેશબોર્ડ",
      "projects": "પ્રોજેક્ટ્સ",
      "analyzer": "ટેન્ડર એનાલાઈઝર",
      "chat": "ટેન્ડર ચેટ",
      "documents": "દસ્તાવેજો",
      "reports": "રિપોર્ટ્સ",
      "notifications": "સૂચનાઓ",
      "profile": "વ્યાપાર પ્રોફાઇલ",
      "settings": "સેટિંગ્સ",
      "admin_panel": "એડમિન પેનલ",
      "super_admin": "સુપર એડમિન",
      "admin": "એડમિન",
      "logout": "લોગ આઉટ",
      "free_plan": "મફત યોજના",
      "premium_plan": "પ્રીમિયમ યોજના",
      "admin_access": "એડમિન એક્સેસ",
      "superadmin_access": "સુપરએડમિન એક્સેસ",
      "upgrade_to_premium": "પ્રીમિયમમાં અપગ્રેડ કરો",
      "enter_activation_code": "એક્ટિવેશન કોડ દાખલ કરો",
      "activation_code": "એક્ટિવેશન કોડ",
      "activate": "સક્રિય કરો",
      "days_remaining": "દિવસ બાકી",
      "locked_feature": "પ્રીમિયમ સુવિધા",
      "premium_required": "આ સુવિધા માટે પ્રીમિયમ સબ્સ્ક્રિપ્શનની જરૂર છે."
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
