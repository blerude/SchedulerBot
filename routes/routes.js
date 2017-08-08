var express = require('express');
var router = express.Router();
var models = require('../models');
var User = models.User;
var Reminder = models.Reminder;
var Meeting = models.Meeting;
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var axios = require('axios');
var WebClient = require('@slack/client').WebClient;
var webToken = process.env.SLACK_API_TOKEN || ''; //see section above on sensitive data
var web = new WebClient(webToken);

//////////////////////////////// PUBLIC ROUTES ////////////////////////////////
// Users who are not logged in can see these routes

var oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/googleauth/callback'
);

// Adds event to the calendar
var addEvent = (subject, invitees, start, end) => {
  var attendees = [];
  // Get all the emails for every invitee
  var emailsPromise = invitees.map(username => {
    return User.findOne({ slackRealName: username }).exec()
  })
  Promise.all(emailsPromise)
  .then(users => {
    // Add emails to a list of attendees
    users.forEach(user => {
      attendees.push({ email: user.slackEmail });
    })

    // Create event
    var event = {
      summary: subject,
      start: {
        dateTime: new Date(start)
      },
      end: {
        dateTime: new Date(end)
      },
      attendees: attendees
    };

    // Submit event to Google Calendar
    var calendar = google.calendar('v3');
    calendar.events.insert({
      auth: oauth2Client,
      calendarId: 'primary',
      resource: event,
    }, function(err, e) {
      if (err) {
        console.log('Error inserting the Google calendar event', err);
        return;
      }
    });
  })
  .catch(err => {
    console.log('Email promise chain error', err);
  })
}

// Google authorization route
router.get('/googleoauth', (req, res) => {
  // Generate the link for users to click on in order to initiate authentication
  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/plus.me'
    ],
    state: encodeURIComponent(JSON.stringify({
      auth_id: req.query.auth_id,
      subject: req.query.subject || 'Meeting',
      date: req.query.date,
      time: req.query.time,
      invitees: req.query.invitees
    }))
  });
  res.redirect(url);
})

router.get('/googleauth/callback', (req, res) => {
  // If no state has been set, initiate event sign up
  if (!req.query.state) {
    oauth2Client.setCredentials(JSON.parse(req.query.tokens));
    if (req.query.time) {
      startDate = new Date(req.query.date + 'T' + req.query.time + '-07:00').getTime();
      endDate = startDate + (30 * 60 * 1000);
    } else {
      startDate = new Date(req.query.date + 'T00:00:00-07:00').getTime();
      endDate = startDate + (24 * 60 * 60 * 1000);
    }
    var sub = req.query.subject || 'Meeting';
    var invitees = [];
    if (req.query.invitees) {
      invitees = req.query.invitees.split('_').map(sb => sb.split('0').join(' '));
    }
    addEvent(sub, invitees, startDate, endDate);
    res.send('Event added!');
  } else { // Begin authorization process in order to create event
    oauth2Client.getToken(req.query.code, (err, tokens) => {
      // tokens contains an access_token and an optional refresh_token
      if (!err) {
        oauth2Client.setCredentials(tokens);
        // Find the correct user
        User.findOne({ slackId: JSON.parse(decodeURIComponent(req.query.state)).auth_id })
          .then(user => {
            // Create their tokens
            user.tokens = tokens;
            user.save()
            .then(user => {
              var state = JSON.parse(decodeURIComponent(req.query.state));
              var startDate = 0;
              var endDate = 0;
              var invitees = [];
              // Send a notice that the user can now go back to invite others
              if (state.time !== undefined) {
                startDate = new Date(state.date + 'T' + state.time + '-07:00').getTime();
                endDate = startDate + (30 * 60 * 1000);
                invitees = state.invitees.split('_').map(sb => sb.split('0').join(' '));
                res.send('You are authorized! Now go back to Slack and schdule the meeting with your bot! ^');
              } else {
                startDate = new Date(state.date + 'T00:00:00-07:00').getTime();
                endDate = startDate + (24 * 60 * 60 * 1000);
                addEvent(state.subject, invitees, startDate, endDate);
                res.redirect('https://calendar.google.com/calendar');
              }
            })
            .catch(err => {
              console.log('Error saving tokens', err)
            })
          })
          .catch(err => {
            console.log('Error finding user to authorize', err);
          })
        }
    });
  }
})

// Route for dealing with responses to interactive messages
router.post('/interactive', (req, res) => {
  // Parse the payload in order to determine user response
  var string = JSON.parse(req.body.payload);
  // If rescheduling, update the new time with the selected value
  if (string.actions[0].selected_options) {
    var newMeet = string.actions[0].selected_options[0].value;
    // Ensure that the meeting was not cancelled
    if (newMeet !== 'cancel') {
      var day = new Date(newMeet);
      var offset = day.getTimezoneOffset()*60*1000;
      var newDate = new Date(day.getTime() - offset).toISOString().split('T')
    }
  }

  // Find the user
  User.findOne({slackId: string.user.id}, function(err, messager) {
    // If the meeting was cancelled, do so and refresh pending
    if (string.actions[0].value === 'cancel' || newMeet === 'cancel') {
      res.send('Scheduler cancelled');
      messager.pending = '';
      messager.save();
    } else if (string.actions[0].value === 'sendRequest') {
      // Generate next prompt, asking users what to do if no response has been received in two hours
      var prompt2 = {
        text: "2 HOUR CONFIRMATION",
        attachments: [
          {
            text: "Schedule the meeting anyway if invitees don't repond in 2 hours?",
            fallback: "You could not confirm your meeting",
            callback_id: "meeting",
            color: "#3AA3E3",
            attachment_type: "default",
            actions: [
              {
                name: "confim",
                text: "Yes",
                type: "button",
                value: "scheduleMeeting"
              },
              {
                name: "confirm",
                text: "Cancel",
                type: "button",
                value: "cancelIn2Hours"
              }
            ]
          }
        ]
      }

      web.chat.postMessage(string.channel.id, "Action Confirmation", prompt2)

      var pending = JSON.parse(messager.pending)
      pending.invitee.forEach(inv => {
        var id = inv.slice(2);
        User.findOne({slackId: id}, function(err, user) {
          if (err) console.log('Error finding user to invite', err);
          else {
            web.chat.postMessage('@' + user.slackUsername, `Please authorize your Google Calendar for a meeting: http://localhost:3000/googleoauth?auth_id=${id}`)
          }
        })
      })
      res.send('We reached out to your invitees.');
    } else if (string.actions[0].value === 'scheduleMeeting' || string.actions[0].value === 'cancelIn2Hours') {
      // Response to the prompts to check back in two hours
      res.send("Meeting will be updated within two hours");
      var pending = JSON.parse(messager.pending)

      if (string.actions[0].value === 'scheduleMeeting') {
        var cancel = false
      } else {
        var cancel = true;
      }
      // Create a new pending meeting
      new Meeting({
        subject: pending.subject,
        date: pending.date,
        time: pending.time,
        invitees: pending.invitee,
        location: '',
        length: '',
        created: false,
        createdAt: new Date().getTime() - 7*60*60*1000,
        cancelIn2Hours: cancel,
        user: messager._id,
        channel: messager.channel
      }).save((err, saved) => {
        if (err) {
          console.log("Error saving pending meeting", err)
        } else {
          // Clear pending
          messager.pending = '';
          messager.save();
        }
      });
    } else {
      // Confirmation message
      var pending = JSON.parse(messager.pending)
      if (newDate) {
        pending.date = newDate[0]
        pending.time = newDate[1].slice(0, 8)
      }
      // If saving a meeting...
      if (pending.invitee) {
        // Create new meeting
        new Meeting({
          subject: pending.subject,
          date: pending.date,
          time: pending.time,
          invitees: pending.invitee,
          location: '',
          length: '',
          created: true,
          user: messager._id,
          channel: messager.channel
        }).save(function(err, savedMeeting) {
          if (err) {
            console.log("Error saving meeting", err)
          } else {
            // Confirm it and create message
            var formatSubject = pending.subject.split(' ').join('_')
            var stringInvitees = pending.invitee.map(inv => {
              return inv.split(' ').join('0');
            })
            var formatInvitees = stringInvitees.join('_')
            // Make sure user is authenticated
            if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
              res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}&tokens=${JSON.stringify(messager.tokens)}`);
            } else {
              res.send(`Oops! You need to authorize your Google Calendar first:: http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}`);
            }
          }
        })
      } else {
        // Save a reminder
        new Reminder({
          subject: pending.subject,
          date: pending.date,
          user: messager._id,
          channel: messager.channel
        }).save(function(err) {
          if (err) {
            console.log("Error saving reminder", err)
          } else {
            var formatSubject = pending.subject.split(' ').join('_');
            // Make sure user is authenticated
            if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
              res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&tokens=${JSON.stringify(messager.tokens)}`);
            } else {
              res.send(`Oops! You need to authorize your Google Calendar first:: http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}`);
            }
          }
        })
      }
      // Clear pending
      messager.pending = '';
      messager.save();
    }
  })
})

module.exports = {
  router,
  oauth2Client
};
