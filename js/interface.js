(function () {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu')
  };

  var topMenu = Fliplet.App.Settings.get('topMenu') || { id: 'pages' };
  var $appMenu = $('#app-menu');

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  var menusPromises = {};
  var menusData = {};

  Fliplet.DataSources.get({ type: 'menu' })
    .then(function (dataSources) {
      if (dataSources.length === 0) {
        $("#initial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function (dataSource) {
        menusPromises[dataSource.id] = [];
        menusData[dataSource.id] = [];
        $('#select-menu').append(templates.menuOption(dataSource));
        $('#accordion').append(templates.menu(dataSource));

        $appMenu.append('<option value="' + dataSource.id + '">' + dataSource.name + '</option>');

        Fliplet.DataSources.connect(dataSource.id)
          .then(function (source) {
            currentDataSource = source;
            return source.find();
          })
          .then(function (rows) {
            if (!rows || !rows.length) {
              return;
            }

            console.log(dataSource.name + ' > Links: ', rows);

            rows.forEach(function (row) {
              menusData[dataSource.id].push(row);
              var selector = '[data-id='+ row.id +']  .link';
              row.data.options = {
                label: true
              };

              $('#menu-' + dataSource.id).append(templates.menuLink(row));

              var linkProvider = Fliplet.Widget.open('com.fliplet.link', {
                closeOnSave: false,
                selector: selector,
                data: row.data.action
              });
              linkProvider.row = row;
              menusPromises[dataSource.id].push(linkProvider);
            });
          });
      });

      $appMenu
        .val(topMenu.id)
        .change(function () {
          var value = $(this).val();
          topMenu.id = value;
          Fliplet.App.Settings.set({ topMenu: topMenu }).then(function () {
            Fliplet.Studio.emit('reload-page-preview');
          });
        })

      console.log('Data Sources: ', dataSources);
    });

  // Listeners
  $('#select-menu').on('change', function onMenuChange() {
    // Change visible links
    var menuId = $(this).val();
    $('#accordion .menu').hide();
    $('#menu-' + menuId).show();

    // Change menu name on input
    var menuName = getSelectedMenuName();
    setMenuName(menuName);
  });

  $('#save').on('click', function () {
    // Get new data source name
    var newMenuName = getMenuName();
    var selectedMenuId = getSelectedMenuId();

    if (!selectedMenuId) {
      return;
    }

    var options = {
      id: selectedMenuId,
      name: newMenuName
    };

    // Update data source if name was changed
    if (getSelectedMenuName() !== newMenuName) {
      Fliplet.DataSources.update(options)
        .then(function () {
          setSelectedMenuName(newMenuName);
        });
    }

    // Update Links

    menusPromises[selectedMenuId].forEach(function (linkActionProvider) {
      console.log('Row attached: ', linkActionProvider.row);

      linkActionProvider.then(function (data) {
        console.log('Data to save: ', data);
        linkActionProvider.row.data.action = data.data;
        linkActionProvider.row.data.order = 1;

        Fliplet.DataSources.connect(selectedMenuId)
          .then(function (source) {
            return source.update(linkActionProvider.row)
          });
      });

      linkActionProvider.forwardSaveRequest();
    })
  });

  // Getters / Setters
  function getSelectedMenuId() {
    return $('#select-menu').val();
  }

  function getSelectedMenuName() {
    return $('#select-menu option:selected').text();
  }

  function setSelectedMenuName(name) {
    return $('#select-menu option:selected').text(name);
  }

  function getMenuName() {
    return $('#menu-name').val();
  }

  function setMenuName(name) {
    return $('#menu-name').val(name);
  }
})();
