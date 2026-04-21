const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: 80,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    company: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      enum: ['AI Automation', 'Software Development', 'Consultancy', 'Support', 'General'],
      default: 'General',
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: 5000,
    },
    // Email delivery tracking
    notificationSent: { type: Boolean, default: false },
    confirmationSent:  { type: Boolean, default: false },
    // Internal CRM status
    status: {
      type: String,
      enum: ['new', 'read', 'replied', 'closed'],
      default: 'new',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Contact', ContactSchema);
