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

var addEvent = (subject, invitees, start, end) => {
  var attendees = [];
  console.log('INPUT', invitees);
  var emailsPromise = invitees.map(username => {
    console.log('USERNAME', username);
    return User.findOne({ slackRealName: username }).exec()
  })
  Promise.all(emailsPromise)
    .then(users => {
      users.forEach(user => {
        console.log('FOUND USER', user.slackEmail);
        attendees.push({ email: user.slackEmail });
      })
      console.log('ATTENDEES EMAIl', attendees);

      var event = {
        summary: subject,
        // location: '800 Howard St., San Francisco, CA 94103',
        // description: 'A chance to hear more about Google\'s developer products.',
        start: {
          dateTime: new Date(start)
          // timeZone: 'America/New_York'
        },
        end: {
          dateTime: new Date(end)
          // timeZone: 'America/New_York'
        },
        attendees: attendees
      };

      var calendar = google.calendar('v3');
      calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event,
      }, function(err, e) {
        if (err) {
          console.log('ERROR4', err);
          return;
        }
        console.log('Event created: %s', e.htmlLink);
      });
    })
    .catch(err => {
      console.log('ERROR5', err);
    })
  }



router.get('/googleoauth', (req, res) => {
  console.log('ID', process.env.GOOGLE_CLIENT_ID);
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
  console.log('URL', url);
  res.redirect(url);
})

router.get('/googleauth/callback', (req, res) => {
  // console.log('AFTER FUNCTION', JSON.parse(decodeURIComponent(req.query.state)));

  if (!req.query.state) {
    console.log('BEFORE PARSE', req.query.tokens);
    console.log('AUTHORIZED', JSON.parse(req.query.tokens));
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
  } else {
    console.log('NOTAUTHORIZED', JSON.parse(decodeURIComponent(req.query.state)));
    oauth2Client.getToken(req.query.code, (err, tokens) => {
      // tokens contains an access_token and an optional refresh_token
      if (!err) {
        console.log('TOKEN', tokens);
        oauth2Client.setCredentials(tokens);
        User.findOne({ slackId: JSON.parse(decodeURIComponent(req.query.state)).auth_id })
          .then(user => {
            console.log('FOUND USER!', user);
            user.tokens = tokens;
            user.save()
              .then(user => {
                console.log('SAVED', user);
                var state = JSON.parse(decodeURIComponent(req.query.state));
                var startDate = 0;
                var endDate = 0;
                var invitees = [];
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
          })
          .catch(err => {
            console.log('ERROR6', err);
          })
        }
    });
  }
})

router.post('/interactive', (req, res) => {
  console.log('IN INTERACTIVE');
  var string = JSON.parse(req.body.payload);
  console.log('STRINGGG', string);
  if (string.actions[0].selected_options) {
    var newMeet = string.actions[0].selected_options[0].value;
    if (newMeet !== 'cancel') {
      var day = new Date(newMeet);
      var offset = day.getTimezoneOffset()*60*1000;
      var newDate = new Date(day.getTime() - offset).toISOString().split('T')
    }
  }

  console.log(string)
  User.findOne({slackId: string.user.id}, function(err, messager) {
    if (string.actions[0].value === 'cancel' || newMeet === 'cancel') {
      console.log('CANCELLED!')
      res.send('Scheduler cancelled');
      messager.pending = '';
      messager.save();
    } else if (string.actions[0].value === 'scheduleMeeting' || string.actions[0].value === 'cancelIn2Hours') {
      res.send("We'll check in 2 hours");
      console.log('MESSANGERE', messager)
      var pending = JSON.parse(messager.pending)

      if (string.actions[0].value === 'scheduleMeeting') {
        var cancel = false
      } else {
        var cancel = true;
      }
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
        messager.pending = '';
        messager.save();
      });

    } else if (string.actions[0].value === 'sendRequest') {
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

      web.chat.postMessage(string.channel.id, "2 hour", prompt2, function(err, res) {
        if (err) {
          console.log('ERROR1', err);
        } else {
          console.log('SCHEDULE 2 SENT', res);
        }
      })

      var pending = JSON.parse(messager.pending)
      console.log('INVITEES', pending);
      pending.invitee.forEach(inv => {
        var id = inv.slice(2);
        User.findOne({slackId: id}, function(err, user) {
          if (err) console.log('ERROR2', err);
          else {
            web.chat.postMessage('@' + user.slackUsername, `Please authorize your Google Calendar for a meeting: http://localhost:3000/googleoauth?auth_id=${id}`, function(err, res) {
              if (err) {
                console.log('ERROR3', err);
              } else {
                console.log('AUTH TO INVITEE SENT', res);
              }
            })
          }
        })
      })
      res.send('HEYY PROMPT HAS BEEN MADE');

    } else {
      console.log('MESSAGER', messager);
      var pending = JSON.parse(messager.pending)
      if (newDate) {
        pending.date = newDate[0]
        pending.time = newDate[1].slice(0, 8)
      }
      console.log('saving...')
      if (pending.invitee) {
        console.log('...a meeting');
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
            console.log(err)
          } else {
            console.log('CONFIRMED MEETING', savedMeeting);
            var formatSubject = pending.subject.split(' ').join('_')
            var stringInvitees = pending.invitee.map(inv => {
              return inv.split(' ').join('0');
            })
            console.log('invitee string' + stringInvitees)
            var formatInvitees = stringInvitees.join('_')
            if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
              res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}&tokens=${JSON.stringify(messager.tokens)}`);
            } else {
              res.send(`Oops! You need to authorize your Google Calendar first:: http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}`);
            }
          }
        })
      } else {
        console.log('...a reminder')
        new Reminder({
          subject: pending.subject,
          date: pending.date,
          user: messager._id,
          channel: messager.channel
        }).save(function(err) {
          console.log('CONFIRMED REMINDER', pending);
          var formatSubject = pending.subject.split(' ').join('_');
          if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
            res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&tokens=${JSON.stringify(messager.tokens)}`);
          } else {
            res.send(`Oops! You need to authorize your Google Calendar first:: http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}`);
          }
        })
      }
      messager.pending = '';
      messager.save();
    }
  })
})

module.exports = {
  router,
  oauth2Client
};
