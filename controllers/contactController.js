const Contact = require("../models/Contact");
const nodemailer = require("nodemailer");
const buildNotificationEmail = require("../templates/notificationEmail");
const buildConfirmationEmail = require("../templates/confirmationEmail");

// ─── Reusable transporter ─────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ─── POST /api/contact ────────────────────────────────────────────────────────
const submitContact = async (req, res) => {
  const { firstName, lastName, email, company, subject, message } = req.body;
  console.log({ doc: req.body });

  // Required field validation
  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all required fields.",
    });
  }

  // Validate subject against allowed enum
  const allowedSubjects = [
    "AI Automation",
    "Software Development",
    "Consultancy",
    "Support",
    "General",
  ];
  if (!allowedSubjects.includes(subject)) {
    return res.status(400).json({
      success: false,
      message: "Invalid subject selected.",
    });
  }

  try {
    // 1. Persist to MongoDB
    const contact = await Contact.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      company: company ? company.trim() : "",
      subject,
      message: message.trim(),
    });

    const transporter = createTransporter();

    // 2. Internal notification → support@stemfra.com
    const notification = buildNotificationEmail({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      company: contact.company,
      subject: contact.subject,
      message: contact.message,
      createdAt: contact.createdAt,
    });

    const toStemfra = await transporter.sendMail({
      from: `"STEMfra" <${process.env.GMAIL_USER}>`,
      to: process.env.NOTIFY_EMAIL,
      subject: notification.subject,
      html: notification.html,
      text: notification.text,
    });

    console.log({ toStemfra });

    console.log("updating contact")

    await Contact.findByIdAndUpdate(contact._id, { notificationSent: true });
//========{temporarily suspended}================================================

    // 3. Confirmation email → client
    // const confirmation = buildConfirmationEmail({
    //   firstName: contact.firstName,
    //   subject: contact.subject,
    //   message: contact.message,
    // });
      // console.log("Confirmation email successful")
    // const toUser = await transporter.sendMail({
    //   from: `"STEMfra" <${process.env.GMAIL_USER}>`,
    //   to: contact.email,
    //   subject: confirmation.subject,
    //   html: confirmation.html,
    //   text: confirmation.text,
    // });
    // console.log({ toUser });


    // await Contact.findByIdAndUpdate(contact._id, { confirmationSent: true });

//========{temporarily suspended}================================================

      console.log("success")

    return res.status(201).json({
      success: true,
      message:
        "Your message has been received. We'll be in touch within one business day.",
    });
  } catch (err) {
    console.error("[contactController] Error:", err.message);
   
    return res.status(500).json({
      success: false,
      message:
        "Something went wrong. Please try again or email us at support@stemfra.com",
    });
  }
};

// ─── GET /api/contact — list all submissions (internal use) ───────────────────
const getContacts = async (req, res) => {
  try {
    const contacts = await Contact.find()
      .sort({ createdAt: -1 })
      .select("-__v");
    return res
      .status(200)
      .json({ success: true, count: contacts.length, data: contacts });
  } catch (err) {
    console.error("[contactController] Fetch error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch contacts." });
  }
};

module.exports = { submitContact, getContacts };
