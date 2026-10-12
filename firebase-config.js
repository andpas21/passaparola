// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDPHPaUZPFwWf1NePqW6KLHrmugCXrFqoQ",
  authDomain: "passaparola-5ae08.firebaseapp.com",
  databaseURL: "https://passaparola-5ae08-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "passaparola-5ae08",
  storageBucket: "passaparola-5ae08.firebasestorage.app",
  messagingSenderId: "614972334368",
  appId: "1:614972334368:web:4e66a24a0ec2520959b745",
  measurementId: "G-TP37X0B6R4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
