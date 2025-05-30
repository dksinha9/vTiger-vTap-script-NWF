VTAP.Detail.Record().then( (record) => {
      console.log(record);
})

// VTAP.Detail.Relations().then( (relations) => { 
//           console.log(relations);
// });

//  VTAP.Detail.RelatedRecords('Invoice', {}).then(
//             (records) => {console.log(records);});

// 213433


// VTAP.Api.Get('records', {id : '213433', 
//   module : 'Invoice'}, (error, response) => {
//       VTAP.Api.Get('records', {id : "213412", 
//   module : 'Potentials'}, (error, response) => {
//       console.log(response);
// });
//       console.log(response);
// });

// VTAP.Api.Get('records', {id : '213412', 
//   module : 'Potentials'}, (error, response) => {
//       console.log(response);
//   });

// VTAP.Utility.ShowErrorNotification("helllo Heelo");

//  VTAP.CustomApi.Post('Find PPPoE id using MikroTik API', {
//       'PPPoE_Username': ["=name=100402310-2311210"]
//     }, (error, response) => {
//       if (error) {
//         console.error(error);
//       } else {
//           let data = JSON.parse(response.content);
//       let userId = data[0]['.id'];
//         console.log("PPPoE Record Found:", response);
//                 console.log("data", data);
//                                 console.log("userId", userId);

//       }
//     });

// VTAP.Api.Put('records', {module : 'Payments', id : '213434', description:"Hello, Test"}, (error, response) => {
   
// });
