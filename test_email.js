require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.sendMail({
  from: process.env.EMAIL_USER,
  to: process.env.EMAIL_USER,
  subject: "Test Email",
  text: "Testing 123"
}, (err, info) => {
  if (err) {
    console.error("Error sending email:", err.message);
    process.exit(1);
  } else {
    console.log("Email sent successfully:", info.response);
    process.exit(0);
  }
});
